import { analyzeCrawl } from "./analyzer";
import type { BusinessModel, CompetitorCandidate, CrawlPage, PublicCompetitor } from "./types";
import { normalizeAndValidateUrl } from "./url";

const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search";
const EXCLUDED_HOSTS = /(^|\.)(facebook|instagram|linkedin|youtube|x|twitter|trustpilot|wikipedia|reddit|pinterest|indeed|amazon|bol|marktplaats|yelp|tripadvisor|kvk|startpagina|goudengids|cbinsights|crunchbase|similarweb|ahrefs|semrush|companyinfo|zoominfo|rocketreach|europages)\./i;
const NON_COMPETITOR_PATH = /\/(blog|nieuws|news|articles?|artikelen?|reviews?|vergelijk|comparison|directory|gids|lijst|top-?\d+|privacy|voorwaarden|terms)(\/|$)/i;
const NON_COMPETITOR_TEXT = /\b(alternatives?|competitors?|concurrenten|vergelijk(?:en|ing)?|comparison|ranking|top\s*\d+|directory|bedrijvengids)\b/i;
const TOKEN_STOP_WORDS = new Set(["and", "the", "for", "from", "with", "online", "assortment", "bedrijf", "bedrijven", "voor", "van", "met", "een", "het", "de", "en", "webshop", "winkel", "nederland"]);

export type SearchCandidate = { title: string; description: string; url: string };
export type ScanProfile = { url: string; companyName: string; primaryOffer: string; businessModel: BusinessModel };
type NamedCandidate = { name: string; reason: string; evidenceUrls: string[] };

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

async function searchWeb(query: string, profile: ScanProfile, apiKey: string, limit = 8) {
  const response = await fetch(FIRECRAWL_SEARCH_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      limit,
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
  return (body.data?.web || []).flatMap((item) => item.url ? [{ title: item.title || hostname(item.url), description: item.description || "", url: item.url }] : []);
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
          json_schema: { name: "competitor_market", strict: true, schema: { type: "object", properties: { market: { type: "string", minLength: 3, maxLength: 90 } }, required: ["market"], additionalProperties: false } },
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

function directResultFallback(profile: ScanProfile, results: SearchCandidate[]): NamedCandidate[] {
  return filterCompetitorCandidates(results, profile.url, profile.companyName).slice(0, 3).map((candidate) => ({
    name: candidate.title.split(/[|–—-]/)[0].trim() || hostname(candidate.url).split(".")[0],
    reason: `Public search result matching ${profile.primaryOffer.slice(0, 90)}.`,
    evidenceUrls: [candidate.url],
  }));
}

async function extractNamedCandidates(profile: ScanProfile, evidence: SearchCandidate[], apiKey?: string): Promise<NamedCandidate[]> {
  if (!apiKey || !evidence.length) return directResultFallback(profile, evidence);
  try {
    const evidenceUrls = evidence.map((item) => item.url);
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini",
        temperature: 0,
        max_completion_tokens: 420,
        messages: [
          { role: "system", content: "Identify up to three plausible direct competitors explicitly named in the supplied public search evidence. Match business model, offer, customer and Dutch market. Do not include the submitted company, directories, publishers, marketplaces or unrelated companies. Give a concise evidence-based reason. Do not invent names." },
          { role: "user", content: JSON.stringify({ company: profile, evidence }) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "competitor_names",
            strict: true,
            schema: {
              type: "object",
              properties: {
                candidates: {
                  type: "array", maxItems: 3,
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string", minLength: 2, maxLength: 100 },
                      reason: { type: "string", minLength: 10, maxLength: 220 },
                      evidenceUrls: { type: "array", minItems: 1, maxItems: 3, items: { type: "string", enum: evidenceUrls } },
                    },
                    required: ["name", "reason", "evidenceUrls"], additionalProperties: false,
                  },
                },
              },
              required: ["candidates"], additionalProperties: false,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok) return directResultFallback(profile, evidence);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(body.choices?.[0]?.message?.content || "{}") as { candidates?: NamedCandidate[] };
    return parsed.candidates?.slice(0, 3) || [];
  } catch {
    return directResultFallback(profile, evidence);
  }
}

function bestOfficialResult(name: string, results: SearchCandidate[], profile: ScanProfile) {
  const filtered = filterCompetitorCandidates(results, profile.url, profile.companyName);
  const target = brandKey(name);
  return [...filtered]
    .map((candidate, index) => {
      const hostBrand = brandKey(hostname(candidate.url).split(".")[0]);
      const titleBrand = brandKey(candidate.title);
      const exactness = hostBrand === target ? 100 : titleBrand.includes(target) ? 80 : target.includes(hostBrand) ? 60 : 0;
      return { candidate, score: exactness - index };
    })
    .sort((a, b) => b.score - a.score)[0]?.candidate || null;
}

export async function discoverPublicCompetitorCandidates(profile: ScanProfile, firecrawlKey: string, openrouterKey?: string): Promise<CompetitorCandidate[]> {
  const market = await resolveMarket(profile, openrouterKey);
  const evidenceSets = await Promise.all([
    searchWeb(`"${profile.companyName}" concurrenten vergelijkbare bedrijven Nederland`, profile, firecrawlKey, 8),
    searchWeb(`${market} ${profile.businessModel === "Ecommerce" ? "webshop winkel" : "bedrijf"} Nederland`, profile, firecrawlKey, 8),
  ]);
  const evidence = evidenceSets.flat().filter((item, index, all) => all.findIndex((candidate) => candidate.url === item.url) === index);
  const names = await extractNamedCandidates(profile, evidence, openrouterKey);
  const resolved = await Promise.all(names.map(async (candidate) => {
    const results = await searchWeb(`"${candidate.name}" officiële website Nederland`, profile, firecrawlKey, 4);
    const official = bestOfficialResult(candidate.name, results, profile);
    return official ? { name: candidate.name, url: official.url, reason: candidate.reason, evidenceUrls: candidate.evidenceUrls } : null;
  }));
  const seen = new Set<string>();
  return resolved.flatMap((candidate) => {
    if (!candidate || seen.has(candidate.url)) return [];
    seen.add(candidate.url);
    return [candidate];
  }).slice(0, 3);
}

export async function selectDirectCompetitor(profile: ScanProfile, candidates: SearchCandidate[]) {
  if (!candidates.length) return null;
  const offerTokens = tokens(profile.primaryOffer);
  return [...candidates]
    .map((candidate, index) => ({ candidate, score: offerTokens.filter((token) => `${candidate.title} ${candidate.description}`.toLowerCase().includes(token)).length * 10 - index }))
    .sort((a, b) => b.score - a.score)[0]?.candidate || null;
}

export function competitorFromPages(seedUrl: string, pages: CrawlPage[]): PublicCompetitor {
  const report = analyzeCrawl(pages, seedUrl, 0);
  return { name: report.companyName, url: seedUrl, pagesAnalyzed: report.pages.length, score: report.score, estimatedClicks: report.overview.estimatedClicks, findings: report.gaps };
}
