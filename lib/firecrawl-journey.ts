import type { JourneyPageType, ObservedJourney } from "./types";
import { normalizeAndValidateUrl, siteHostname } from "./url";

const FIRECRAWL_URL = "https://api.firecrawl.dev/v2";
const PAGE_TYPES = new Set<JourneyPageType>(["Homepage", "Category", "Product", "Cart", "Checkout", "Other"]);

function headers(apiKey: string) {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

async function errorMessage(response: Response) {
  try {
    const body = await response.json() as { error?: string; message?: string };
    return body.error || body.message || `Firecrawl returned ${response.status}.`;
  } catch {
    return `Firecrawl returned ${response.status}.`;
  }
}

export function parseObservedJourney(raw: string, startUrl: string): ObservedJourney | null {
  try {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first < 0 || last <= first) return null;
    const parsed = JSON.parse(raw.slice(first, last + 1)) as Partial<ObservedJourney>;
    if (parsed.status !== "complete" || !Array.isArray(parsed.stages) || parsed.stages.length < 3 || parsed.stages.length > 8) return null;
    if (parsed.clicks !== parsed.stages.length) return null;
    const hostname = siteHostname(startUrl);
    const stages = parsed.stages.flatMap((stage) => {
      if (!stage || typeof stage.url !== "string" || siteHostname(stage.url) !== hostname) return [];
      if (typeof stage.action !== "string" || !stage.action.trim() || typeof stage.title !== "string") return [];
      if (!PAGE_TYPES.has(stage.pageType as JourneyPageType)) return [];
      return [{
        pageType: stage.pageType as JourneyPageType,
        title: stage.title.slice(0, 120),
        url: stage.url,
        action: stage.action.slice(0, 160),
        ctaText: typeof stage.ctaText === "string" ? stage.ctaText.slice(0, 90) : null,
      }];
    });
    if (stages.length !== parsed.stages.length) return null;
    const actions = stages.map((stage) => `${stage.action} ${stage.ctaText || ""}`).join(" ");
    if (!/add to (?:cart|bag|basket)|winkelmand|winkelwagen|voeg.*toe|in mandje/i.test(actions)) return null;
    if (!stages.some((stage) => stage.pageType === "Cart") || !stages.some((stage) => stage.pageType === "Checkout")) return null;
    return { status: "complete", clicks: stages.length, stages, limitation: "Verified by a Firecrawl browser session that performed each counted action from an empty cart. No order was submitted." };
  } catch {
    return null;
  }
}

export async function captureCustomerJourney(input: string, apiKey: string): Promise<ObservedJourney | null> {
  const url = normalizeAndValidateUrl(input);
  const scrape = await fetch(`${FIRECRAWL_URL}/scrape`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: false, blockAds: true, removeBase64Images: true, timeout: 12_000, location: { country: "NL", languages: ["nl-NL", "en-US"] } }),
    signal: AbortSignal.timeout(7_000),
  });
  if (!scrape.ok) return null;
  const scraped = await scrape.json() as { data?: { metadata?: { scrapeId?: string } } };
  const scrapeId = scraped.data?.metadata?.scrapeId;
  if (!scrapeId) return null;

  try {
    const interaction = await fetch(`${FIRECRAWL_URL}/scrape/${encodeURIComponent(scrapeId)}/interact`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({
        timeout: 18,
        origin: "acquisition-gap-analyzer",
        prompt: `Start with an empty cart and verify one real customer journey on this website. Use only visible clickable controls. For ecommerce: navigate from the current landing page to a representative product if needed, click the actual Add to cart control, open the cart, then click the checkout control. Stop on the first checkout page; never enter personal or payment data and never place an order. Dismiss cookie consent but do not count it. Record every commercial click actually performed, including product/category discovery, Add to cart, opening cart and opening checkout. Do not infer or invent a step. Return ONLY compact JSON with this exact shape: {"status":"complete"|"incomplete","clicks":number|null,"stages":[{"pageType":"Homepage"|"Category"|"Product"|"Cart"|"Checkout"|"Other","title":"page title","url":"observed URL after the action","action":"performed action","ctaText":"exact clicked label or accessible name"}],"limitation":"reason if incomplete"}. Set status complete only after the browser has actually reached checkout and clicks must equal stages.length.`,
      }),
      signal: AbortSignal.timeout(21_000),
    });
    if (!interaction.ok) return null;
    const body = await interaction.json() as { output?: string; result?: string };
    return parseObservedJourney(body.output || body.result || "", url);
  } finally {
    void fetch(`${FIRECRAWL_URL}/scrape/${encodeURIComponent(scrapeId)}/interact`, { method: "DELETE", headers: headers(apiKey), signal: AbortSignal.timeout(2_000) }).catch(() => undefined);
  }
}
