import { analyzeCrawl } from "./analyzer";
import type { BusinessModel, CompetitorCandidate, CrawlPage, PublicCompetitor } from "./types";
import { normalizeAndValidateUrl } from "./url";

const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search";
const EXCLUDED_HOSTS = /(^|\.)(facebook|instagram|linkedin|youtube|x|twitter|trustpilot|wikipedia|reddit|pinterest|indeed|amazon|bol|marktplaats|yelp|tripadvisor|kvk|startpagina|goudengids|cbinsights|crunchbase|similarweb|ahrefs|semrush|companyinfo|zoominfo|rocketreach|europages)\./i;
const NON_COMPETITOR_PATH = /\/(blog|nieuws|news|articles?|artikelen?|reviews?|vergelijk|comparison|directory|gids|lijst|top-?\d+|privacy|voorwaarden|terms)(\/|$)/i;
const NON_COMPETITOR_TEXT = /\b(alternatives?|competitors?|concurrenten|vergelijk(?:en|ing)?|comparison|ranking|top\s*\d+|directory|bedrijvengids)\b/i;
const SUPPLIER_TEXT = /\b(supplier|supplies|wholesale|wholesaler|manufacturer|distributor|b2b|leverancier|groothandel|producent)\b/i;

export type SearchCandidate = { title: string; description: string; url: string };
export type ScanProfile = { url: string; companyName: string; primaryOffer: string; businessModel: BusinessModel };
export type EntityProfile = {
  industry: string;
  offerCategory: string;
  targetCustomer: "Consumers" | "Businesses" | "Mixed";
  businessRole: "Retailer" | "Service provider" | "Software provider" | "Marketplace" | "Publisher" | "Other";
  geography: string;
};
type NamedCandidate = { name: string; reason: string; evidenceUrls: string[] };
type ResolvedCandidate = CompetitorCandidate & { officialTitle: string; officialDescription: string };

function hostname(value: string) {
  return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
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

export function isValueChainMismatch(entity: EntityProfile, candidateText: string) {
  return entity.targetCustomer === "Consumers" && entity.businessRole === "Retailer" && SUPPLIER_TEXT.test(candidateText);
}

async function searchWeb(query: string, profile: ScanProfile, apiKey: string, limit = 8, excludeOwn = true) {
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
      ...(excludeOwn ? { excludeDomains: [hostname(profile.url)] } : {}),
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Competitor search returned ${response.status}.`);
  const body = await response.json() as { success?: boolean; data?: { web?: Array<{ title?: string; description?: string; url?: string }> }; error?: string };
  if (!body.success) throw new Error(body.error || "Competitor search failed.");
  return (body.data?.web || []).flatMap((item) => item.url ? [{ title: item.title || hostname(item.url), description: item.description || "", url: item.url }] : []);
}

function fallbackEntity(profile: ScanProfile): EntityProfile {
  const isConsumerRetail = profile.businessModel === "Ecommerce";
  return {
    industry: profile.primaryOffer.slice(0, 90),
    offerCategory: profile.primaryOffer.slice(0, 90),
    targetCustomer: isConsumerRetail ? "Consumers" : "Mixed",
    businessRole: isConsumerRetail ? "Retailer" : profile.businessModel === "Marketplace" ? "Marketplace" : "Service provider",
    geography: "Netherlands",
  };
}

async function resolveEntity(profile: ScanProfile, evidence: SearchCandidate[], apiKey?: string): Promise<EntityProfile> {
  if (!apiKey || !evidence.length) return fallbackEntity(profile);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini",
        temperature: 0,
        max_completion_tokens: 220,
        messages: [
          { role: "system", content: "Resolve the submitted company from public evidence. Describe its broad industry, commercial offer category, target customer, role in the value chain and geography. Classify the company itself, not an individual product found on its website." },
          { role: "user", content: JSON.stringify({ submitted: profile, publicEvidence: evidence }) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "company_entity_profile", strict: true,
            schema: {
              type: "object",
              properties: {
                industry: { type: "string", minLength: 3, maxLength: 100 },
                offerCategory: { type: "string", minLength: 3, maxLength: 120 },
                targetCustomer: { type: "string", enum: ["Consumers", "Businesses", "Mixed"] },
                businessRole: { type: "string", enum: ["Retailer", "Service provider", "Software provider", "Marketplace", "Publisher", "Other"] },
                geography: { type: "string", minLength: 2, maxLength: 80 },
              },
              required: ["industry", "offerCategory", "targetCustomer", "businessRole", "geography"], additionalProperties: false,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return fallbackEntity(profile);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return JSON.parse(body.choices?.[0]?.message?.content || "{}") as EntityProfile;
  } catch {
    return fallbackEntity(profile);
  }
}

async function extractNamedCandidates(profile: ScanProfile, entity: EntityProfile, evidence: SearchCandidate[], apiKey?: string): Promise<NamedCandidate[]> {
  if (!apiKey || !evidence.length) return [];
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
          { role: "system", content: "Identify up to three companies explicitly named in the public evidence that are direct competitors of the resolved company. A direct competitor must have the same value-chain role, substantially overlapping offer, same target-customer type and overlapping geography. Reject suppliers, wholesalers and manufacturers when the analyzed company is a consumer retailer. Reject directories, publishers, marketplaces and the submitted company. Do not invent company names." },
          { role: "user", content: JSON.stringify({ submitted: profile, resolvedCompany: entity, evidence }) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "direct_competitor_names", strict: true,
            schema: {
              type: "object",
              properties: {
                candidates: { type: "array", maxItems: 3, items: { type: "object", properties: {
                  name: { type: "string", minLength: 2, maxLength: 100 },
                  reason: { type: "string", minLength: 15, maxLength: 220 },
                  evidenceUrls: { type: "array", minItems: 1, maxItems: 3, items: { type: "string", enum: evidenceUrls } },
                }, required: ["name", "reason", "evidenceUrls"], additionalProperties: false } },
              }, required: ["candidates"], additionalProperties: false,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok) return [];
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(body.choices?.[0]?.message?.content || "{}") as { candidates?: NamedCandidate[] };
    return parsed.candidates?.slice(0, 3) || [];
  } catch {
    return [];
  }
}

function bestOfficialResult(name: string, results: SearchCandidate[], profile: ScanProfile) {
  const filtered = filterCompetitorCandidates(results, profile.url, profile.companyName);
  const target = brandKey(name);
  const ranked = filtered.map((candidate, index) => {
    const hostBrand = brandKey(hostname(candidate.url).split(".")[0]);
    const titleBrand = brandKey(candidate.title);
    const exactness = hostBrand === target ? 100 : titleBrand.includes(target) ? 80 : target.includes(hostBrand) ? 60 : 0;
    return { candidate, score: exactness - index };
  }).sort((a, b) => b.score - a.score);
  return ranked[0] && ranked[0].score >= 55 ? ranked[0].candidate : null;
}

async function validateResolvedCandidates(profile: ScanProfile, entity: EntityProfile, candidates: ResolvedCandidate[], apiKey?: string): Promise<CompetitorCandidate[]> {
  const deterministic = candidates.filter((candidate) => !isValueChainMismatch(entity, `${candidate.officialTitle} ${candidate.officialDescription}`));
  if (!apiKey || !deterministic.length) return [];
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini",
        temperature: 0,
        max_completion_tokens: 360,
        messages: [
          { role: "system", content: "Validate direct competitors conservatively. Accept only companies with the same value-chain role, overlapping core offer, same target-customer type and overlapping geography. Explicitly reject suppliers, manufacturers, wholesalers, agencies, directories and companies that merely sell one similar product. Return only accepted supplied URLs and a short comparison reason." },
          { role: "user", content: JSON.stringify({ submitted: profile, resolvedCompany: entity, candidates: deterministic }) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "validated_direct_competitors", strict: true,
            schema: { type: "object", properties: { accepted: { type: "array", maxItems: 3, items: { type: "object", properties: {
              url: { type: "string", enum: deterministic.map((candidate) => candidate.url) },
              reason: { type: "string", minLength: 15, maxLength: 220 },
            }, required: ["url", "reason"], additionalProperties: false } } }, required: ["accepted"], additionalProperties: false },
          },
        },
      }),
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok) return [];
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(body.choices?.[0]?.message?.content || "{}") as { accepted?: Array<{ url: string; reason: string }> };
    return (parsed.accepted || []).flatMap((accepted) => {
      const candidate = deterministic.find((item) => item.url === accepted.url);
      return candidate ? [{ name: candidate.name, url: candidate.url, reason: accepted.reason, evidenceUrls: candidate.evidenceUrls }] : [];
    });
  } catch {
    return [];
  }
}

export async function discoverPublicCompetitorCandidates(profile: ScanProfile, firecrawlKey: string, openrouterKey?: string): Promise<CompetitorCandidate[]> {
  const entityEvidence = await searchWeb(`"${profile.companyName}" "${hostname(profile.url)}" branche assortiment doelgroep Nederland`, profile, firecrawlKey, 8, false);
  const entity = await resolveEntity(profile, entityEvidence, openrouterKey);
  const evidenceSearches = await Promise.allSettled([
    searchWeb(`"${profile.companyName}" concurrenten vergelijkbare ${entity.businessRole === "Retailer" ? "winkels" : "bedrijven"} Nederland`, profile, firecrawlKey, 8),
    searchWeb(`${entity.offerCategory} ${entity.targetCustomer} ${entity.businessRole} ${entity.geography}`, profile, firecrawlKey, 8),
  ]);
  const evidence = [...entityEvidence, ...evidenceSearches.flatMap((result) => result.status === "fulfilled" ? result.value : [])]
    .filter((item, index, all) => all.findIndex((candidate) => candidate.url === item.url) === index);
  const names = await extractNamedCandidates(profile, entity, evidence, openrouterKey);
  const resolvedResults = await Promise.allSettled(names.map(async (candidate): Promise<ResolvedCandidate | null> => {
    const officialResults = await searchWeb(`"${candidate.name}" officiële website ${entity.geography}`, profile, firecrawlKey, 4);
    const official = bestOfficialResult(candidate.name, officialResults, profile);
    if (!official) return null;
    return { name: candidate.name, url: official.url, reason: candidate.reason, evidenceUrls: candidate.evidenceUrls, officialTitle: official.title, officialDescription: official.description };
  }));
  const resolved = resolvedResults.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
  return (await validateResolvedCandidates(profile, entity, resolved, openrouterKey)).slice(0, 3);
}

export async function selectDirectCompetitor(_profile: ScanProfile, candidates: SearchCandidate[]) {
  return candidates[0] || null;
}

export function competitorFromPages(seedUrl: string, pages: CrawlPage[]): PublicCompetitor {
  const report = analyzeCrawl(pages, seedUrl, 0);
  return { name: report.companyName, url: seedUrl, pagesAnalyzed: report.pages.length, score: report.score, estimatedClicks: report.overview.estimatedClicks, findings: report.gaps };
}
