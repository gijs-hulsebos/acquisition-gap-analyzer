import { analyzeCrawl } from "./analyzer";
import type { BusinessModel, CrawlPage, PublicCompetitor } from "./types";
import { normalizeAndValidateUrl } from "./url";

const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search";
const EXCLUDED_HOSTS = /(^|\.)(facebook|instagram|linkedin|youtube|x|twitter|trustpilot|wikipedia|reddit|pinterest|indeed|amazon|bol|marktplaats|yelp|tripadvisor|kvk|startpagina|goudengids|cbinsights|crunchbase|similarweb|ahrefs|semrush|companyinfo|zoominfo|rocketreach|europages)\./i;
const NON_COMPETITOR_PATH = /\/(blog|nieuws|news|articles?|artikelen?|reviews?|vergelijk|comparison|directory|gids|lijst|top-?\d+|privacy|voorwaarden|terms)(\/|$)/i;
const NON_COMPETITOR_TEXT = /\b(alternatives?|competitors?|concurrenten|vergelijk(?:en|ing)?|comparison|ranking|top\s*\d+|directory|bedrijvengids)\b/i;
const TOKEN_STOP_WORDS = new Set(["and", "the", "for", "from", "with", "online", "assortment", "bedrijf", "bedrijven", "voor", "van", "met", "een", "het", "de", "en", "webshop", "winkel", "nederland"]);

export type SearchCandidate = { title: string; description: string; url: string };
export type ScanProfile = { url: string; companyName: string; primaryOffer: string; businessModel: BusinessModel };

function hostname(value: string) {
  return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
}

function tokens(value: string) {
  return [...new Set(value.toLowerCase().match(/[a-zà-ÿ0-9]{3,}/g) || [])]
    .filter((token) => !TOKEN_STOP_WORDS.has(token));
}

function brandKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function filterCompetitorCandidates(results: SearchCandidate[], ownUrl: string, companyName = "") {
  const ownHost = hostname(ownUrl);
  const ownBrand = brandKey(companyName);
  const seen = new Set<string>();
  return results.flatMap((candidate) => {
    let url: string;
    try { url = normalizeAndValidateUrl(candidate.url); } catch { return []; }
    const parsed = new URL(url);
    const host = hostname(url);
    const candidateBrand = brandKey(`${candidate.title} ${host.split(".")[0]}`);
    if (host === ownHost || EXCLUDED_HOSTS.test(host) || NON_COMPETITOR_PATH.test(parsed.pathname) || NON_COMPETITOR_TEXT.test(candidate.title) || seen.has(host) || (ownBrand.length >= 5 && candidateBrand.includes(ownBrand))) return [];
    seen.add(host);
    return [{ ...candidate, url: parsed.origin }];
  });
}

function fallbackMarket(profile: ScanProfile) {
  return `bedrijven vergelijkbaar met ${profile.companyName}`.slice(0, 90);
}

async function resolveMarket(profile: ScanProfile, apiKey?: string) {
  if (!apiKey) return fallbackMarket(profile);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini",
        temperature: 0,
        max_completion_tokens: 100,
        messages: [
          { role: "system", content: "Convert the supplied company identity and website offer into one broad Dutch market category suitable for finding direct competitors. Use 3 to 7 concrete words. Do not repeat individual product names, the company name or vague terms such as retail, company or webshop." },
          { role: "user", content: JSON.stringify(profile) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "competitor_market",
            strict: true,
            schema: { type: "object", properties: { market: { type: "string", minLength: 3, maxLength: 90 } }, required: ["market"], additionalProperties: false },
          },
        },
      }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return fallbackMarket(profile);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(body.choices?.[0]?.message?.content || "{}") as { market?: string };
    return parsed.market?.trim() || fallbackMarket(profile);
  } catch {
    return fallbackMarket(profile);
  }
}

function searchQuery(profile: ScanProfile, market: string) {
  const model = profile.businessModel === "Ecommerce" ? "webshop winkel" : "bedrijf";
  return `${market} ${model} Nederland officiële website -reviews -vergelijk`;
}

async function searchCandidates(profile: ScanProfile, market: string, apiKey: string) {
  const response = await fetch(FIRECRAWL_SEARCH_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: searchQuery(profile, market),
      limit: 8,
      sources: ["web"],
      country: "NL",
      location: "Netherlands",
      timeout: 6_000,
      ignoreInvalidURLs: true,
      excludeDomains: [hostname(profile.url)],
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Competitor search returned ${response.status}.`);
  const body = await response.json() as { success?: boolean; data?: { web?: Array<{ title?: string; description?: string; url?: string }> }; error?: string };
  if (!body.success) throw new Error(body.error || "Competitor search failed.");
  const results = (body.data?.web || []).flatMap((item) => item.url ? [{ title: item.title || hostname(item.url), description: item.description || "", url: item.url }] : []);
  return filterCompetitorCandidates(results, profile.url, profile.companyName);
}

function fallbackCandidate(profile: ScanProfile, candidates: SearchCandidate[]) {
  const offerTokens = tokens(profile.primaryOffer);
  return [...candidates]
    .map((candidate, index) => ({
      candidate,
      score: offerTokens.filter((token) => `${candidate.title} ${candidate.description}`.toLowerCase().includes(token)).length * 10 - index,
    }))
    .sort((a, b) => b.score - a.score)[0]?.candidate || null;
}

export async function selectDirectCompetitor(profile: ScanProfile, candidates: SearchCandidate[], apiKey?: string) {
  if (!candidates.length) return null;
  if (!apiKey) return fallbackCandidate(profile, candidates);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini",
        temperature: 0,
        max_completion_tokens: 180,
        messages: [
          { role: "system", content: "Select exactly one direct Dutch competitor only when the public search result clearly matches the company's business model, offer and customer market. Reject the submitted company, regional versions of it, directories, publishers, marketplaces, review sites and unrelated businesses. Return null when none is credible. Use only a supplied candidate URL." },
          { role: "user", content: JSON.stringify({ company: profile, candidates }) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "direct_competitor",
            strict: true,
            schema: {
              type: "object",
              properties: { url: { anyOf: [{ type: "string", enum: candidates.map((candidate) => candidate.url) }, { type: "null" }] } },
              required: ["url"], additionalProperties: false,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return fallbackCandidate(profile, candidates);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(body.choices?.[0]?.message?.content || "{}") as { url?: string | null };
    return parsed.url ? candidates.find((candidate) => candidate.url === parsed.url) || fallbackCandidate(profile, candidates) : fallbackCandidate(profile, candidates);
  } catch {
    return fallbackCandidate(profile, candidates);
  }
}

export async function discoverPublicCompetitor(profile: ScanProfile, firecrawlKey: string, openrouterKey?: string) {
  const market = await resolveMarket(profile, openrouterKey);
  return selectDirectCompetitor(profile, await searchCandidates(profile, market, firecrawlKey), openrouterKey);
}

export function competitorFromPages(seedUrl: string, pages: CrawlPage[]): PublicCompetitor {
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
