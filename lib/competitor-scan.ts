import { analyzeCrawl } from "./analyzer";
import { crawlWebsite } from "./firecrawl";
import type { BusinessModel, CompetitorScanResult, PublicCompetitor } from "./types";
import { normalizeAndValidateUrl } from "./url";

const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search";
const EXCLUDED_HOSTS = /(^|\.)(facebook|instagram|linkedin|youtube|x|twitter|trustpilot|wikipedia|reddit|pinterest|indeed|amazon|bol|marktplaats|yelp|tripadvisor|kvk|startpagina|goudengids)\./i;
const NON_COMPETITOR_PATH = /\/(blog|nieuws|news|articles?|artikelen?|reviews?|vergelijk|comparison|directory|gids|lijst|top-?\d+|privacy|voorwaarden|terms)(\/|$)/i;

export type SearchCandidate = { title: string; description: string; url: string };
type ScanProfile = { url: string; companyName: string; primaryOffer: string; businessModel: BusinessModel };

function hostname(value: string) {
  return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
}

export function filterCompetitorCandidates(results: SearchCandidate[], ownUrl: string) {
  const ownHost = hostname(ownUrl);
  const seen = new Set<string>();
  return results.flatMap((candidate) => {
    let url: string;
    try { url = normalizeAndValidateUrl(candidate.url); } catch { return []; }
    const parsed = new URL(url);
    const host = hostname(url);
    if (host === ownHost || EXCLUDED_HOSTS.test(host) || NON_COMPETITOR_PATH.test(parsed.pathname) || seen.has(host)) return [];
    seen.add(host);
    return [{ ...candidate, url: parsed.origin }];
  });
}

function searchQuery(profile: ScanProfile) {
  const model = profile.businessModel === "Ecommerce" ? "webshop winkel" : "bedrijf";
  const offer = profile.primaryOffer.replace(/^Online assortment:\s*/i, "").slice(0, 110);
  return `directe concurrenten van "${profile.companyName}" ${model} ${offer} Nederland`;
}

async function searchCandidates(profile: ScanProfile, apiKey: string) {
  const response = await fetch(FIRECRAWL_SEARCH_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: searchQuery(profile),
      limit: 6,
      sources: ["web"],
      country: "NL",
      location: "Netherlands",
      timeout: 4_500,
      ignoreInvalidURLs: true,
      excludeDomains: [hostname(profile.url)],
    }),
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new Error(`Competitor search returned ${response.status}.`);
  const body = await response.json() as { success?: boolean; data?: { web?: Array<{ title?: string; description?: string; url?: string }> }; error?: string };
  if (!body.success) throw new Error(body.error || "Competitor search failed.");
  const results = (body.data?.web || []).flatMap((item) => item.url ? [{ title: item.title || hostname(item.url), description: item.description || "", url: item.url }] : []);
  return filterCompetitorCandidates(results, profile.url);
}

async function selectDirectCompetitors(profile: ScanProfile, candidates: SearchCandidate[], apiKey?: string) {
  if (!apiKey || candidates.length <= 2) return candidates.slice(0, 2);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini",
        temperature: 0,
        max_completion_tokens: 220,
        messages: [
          { role: "system", content: "Select at most two direct Dutch competitors from the supplied public search results. They must have the same business model, substantially similar offer and customer market. Reject directories, publishers, marketplaces, resellers of unrelated products and the submitted company. Return only URLs from the candidates." },
          { role: "user", content: JSON.stringify({ company: profile, candidates }) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "direct_competitors",
            strict: true,
            schema: {
              type: "object",
              properties: { urls: { type: "array", maxItems: 2, items: { type: "string", enum: candidates.map((candidate) => candidate.url) } } },
              required: ["urls"], additionalProperties: false,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return candidates.slice(0, 2);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(body.choices?.[0]?.message?.content || "{}") as { urls?: string[] };
    const selected = (parsed.urls || []).flatMap((url) => candidates.find((candidate) => candidate.url === url) || []);
    return selected.slice(0, 2);
  } catch {
    return candidates.slice(0, 2);
  }
}

function competitorFromPages(seedUrl: string, pages: Awaited<ReturnType<typeof crawlWebsite>>): PublicCompetitor {
  const report = analyzeCrawl(pages, seedUrl, 0);
  return {
    name: report.companyName,
    url: seedUrl,
    pagesAnalyzed: report.pages.length,
    score: report.score,
    estimatedClicks: report.overview.estimatedClicks,
    findings: report.gaps,
  };
}

/** One public search followed by exactly one crawl per selected competitor, maximum two. */
export async function scanPublicCompetitors(profile: ScanProfile, firecrawlKey: string, openrouterKey?: string): Promise<CompetitorScanResult> {
  const candidates = await searchCandidates(profile, firecrawlKey);
  const selected = await selectDirectCompetitors(profile, candidates, openrouterKey);
  if (!selected.length) return { sourceUrl: profile.url, searchedAt: new Date().toISOString(), competitors: [], note: "No sufficiently direct public competitor was found." };

  const crawled = await Promise.allSettled(selected.map(async (candidate) => competitorFromPages(
    candidate.url,
    await crawlWebsite(candidate.url, firecrawlKey, 3, {
      deadlineMs: 18_000,
      maxDiscoveryDepth: 2,
      pollTimeoutMs: 3_000,
      scrapeTimeoutMs: 10_000,
      startTimeoutMs: 5_000,
    }),
  )));
  const competitors = crawled.flatMap((item) => item.status === "fulfilled" ? [item.value] : []);
  return {
    sourceUrl: profile.url,
    searchedAt: new Date().toISOString(),
    competitors,
    note: competitors.length === 2 ? "Two direct public competitors were analyzed." : competitors.length === 1 ? "One direct public competitor could be analyzed." : "Competitor pages could not be read within this scan.",
  };
}
