import { analyzeCrawl } from "./analyzer";
import type { BusinessModel, CrawlPage, PublicCompetitor } from "./types";
import { normalizeAndValidateUrl } from "./url";

const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search";
const EXCLUDED_HOSTS = /(^|\.)(facebook|instagram|linkedin|youtube|x|twitter|trustpilot|wikipedia|reddit|pinterest|indeed|amazon|bol|marktplaats|yelp|tripadvisor|kvk|startpagina|goudengids)\./i;
const NON_COMPETITOR_PATH = /\/(blog|nieuws|news|articles?|artikelen?|reviews?|vergelijk|comparison|directory|gids|lijst|top-?\d+|privacy|voorwaarden|terms)(\/|$)/i;
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
  return `directe concurrent ${model} ${offer} Nederland -reviews -vergelijk`;
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
  return filterCompetitorCandidates(results, profile.url);
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
    return parsed.url ? candidates.find((candidate) => candidate.url === parsed.url) || null : null;
  } catch {
    return fallbackCandidate(profile, candidates);
  }
}

export async function discoverPublicCompetitor(profile: ScanProfile, firecrawlKey: string, openrouterKey?: string) {
  return selectDirectCompetitor(profile, await searchCandidates(profile, firecrawlKey), openrouterKey);
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
