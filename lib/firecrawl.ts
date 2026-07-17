import type { CrawlPage } from "./types";
import { buildCompetitorSearchQuery, competitorCandidateScore } from "./entity";
import type { ResolvedCompanyEntity } from "./types";
import { normalizeAndValidateUrl } from "./url";

type FirecrawlDocument = {
  markdown?: string;
  html?: string;
  links?: string[];
  metadata?: {
    title?: string;
    description?: string;
    sourceURL?: string;
    url?: string;
    statusCode?: number;
    error?: string;
  };
};

type FirecrawlStartResponse = {
  success?: boolean;
  id?: string;
  error?: string;
};

type FirecrawlStatusResponse = {
  status?: "scraping" | "completed" | "failed" | "cancelled";
  data?: FirecrawlDocument[];
  error?: string;
};

type FirecrawlSearchResult = {
  title?: string;
  description?: string;
  url?: string;
};

type FirecrawlSearchResponse = {
  success?: boolean;
  data?: { web?: FirecrawlSearchResult[] };
  error?: string;
};

type FirecrawlScrapeResponse = {
  success?: boolean;
  data?: FirecrawlDocument;
  error?: string;
};

type FirecrawlMapLink = {
  url?: string;
  title?: string;
  description?: string;
};

type FirecrawlMapResponse = {
  success?: boolean;
  links?: FirecrawlMapLink[];
  error?: string;
};

const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev/v2";
const POLL_INTERVAL_MS = 1100;
const MAX_WAIT_MS = 15_000;

function headers(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function readError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return body.error || body.message || `Firecrawl returned ${response.status}.`;
  } catch {
    return `Firecrawl returned ${response.status}.`;
  }
}

async function crawlWebsiteFallback(url: string, apiKey: string): Promise<CrawlPage[]> {
  const startResponse = await fetch(`${FIRECRAWL_BASE_URL}/crawl`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      url,
      limit: 8,
      maxDiscoveryDepth: 2,
      crawlEntireDomain: false,
      allowExternalLinks: false,
      allowSubdomains: false,
      sitemap: "skip",
      ignoreQueryParameters: true,
      scrapeOptions: {
        formats: ["markdown", "html", "links"],
        onlyMainContent: false,
        blockAds: true,
        removeBase64Images: true,
        timeout: 20_000,
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!startResponse.ok) throw new Error(await readError(startResponse));

  const started = (await startResponse.json()) as FirecrawlStartResponse;
  if (!started.success || !started.id) {
    throw new Error(started.error || "Firecrawl did not start the crawl.");
  }

  const deadline = Date.now() + MAX_WAIT_MS;
  let latestPages: CrawlPage[] = [];
  while (Date.now() < deadline) {
    const statusResponse = await fetch(`${FIRECRAWL_BASE_URL}/crawl/${started.id}`, {
      headers: headers(apiKey),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    if (!statusResponse.ok) throw new Error(await readError(statusResponse));
    const result = (await statusResponse.json()) as FirecrawlStatusResponse;

    latestPages = (result.data || [])
      .map((document): CrawlPage | null => {
        const pageUrl = document.metadata?.sourceURL || document.metadata?.url;
        if (!pageUrl) return null;
        return {
          url: pageUrl,
          title: document.metadata?.title?.trim() || "Untitled page",
          description: document.metadata?.description?.trim() || "",
          markdown: document.markdown || "",
          html: document.html || "",
          links: document.links || [],
          statusCode: document.metadata?.statusCode || 200,
        };
      })
      .filter((page): page is CrawlPage => Boolean(page));

    if (result.status === "failed" || result.status === "cancelled") {
      throw new Error(result.error || "The website crawl could not be completed.");
    }

    if (result.status === "completed") {
      if (!latestPages.length) throw new Error("The crawl completed but returned no readable pages.");
      return latestPages;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  if (latestPages.length) return latestPages;
  throw new Error("The crawl took too long. Try the website again in a moment.");
}

const EXCLUDED_COMPETITOR_HOSTS = /(^|\.)(facebook|instagram|linkedin|youtube|x|twitter|trustpilot|werkspot|telefoonboek|openingstijden|google|yelp|tripadvisor|pinterest|indeed|amazon|bol|marktplaats|kvk|allebedrijven|bedrijvenpagina)\./i;
const NON_COMMERCIAL_RESULT = /\/(blog|nieuws|news|vacature|jobs?|privacy|voorwaarden|terms|reviews?|directory|gids|lijst|top-?10)(\/|$)/i;

async function scrapePage(url: string, apiKey: string, timeout = 8_000): Promise<CrawlPage> {
  const response = await fetch(`${FIRECRAWL_BASE_URL}/scrape`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      url,
      formats: ["markdown", "html", "links"],
      onlyMainContent: false,
      blockAds: true,
      removeBase64Images: true,
      timeout,
    }),
    signal: AbortSignal.timeout(timeout + 1_000),
  });

  if (!response.ok) throw new Error(await readError(response));
  const result = (await response.json()) as FirecrawlScrapeResponse;
  const document = result.data;
  const pageUrl = document?.metadata?.sourceURL || document?.metadata?.url || url;
  if (!result.success || !document) throw new Error(result.error || "The competitor page could not be read.");

  return {
    url: pageUrl,
    title: document.metadata?.title?.trim() || "Untitled competitor page",
    description: document.metadata?.description?.trim() || "",
    markdown: document.markdown || "",
    html: document.html || "",
    links: document.links || [],
    statusCode: document.metadata?.statusCode || 200,
  };
}

type RepresentativeKind = "homepage" | "category" | "product" | "service" | "cart" | "checkout" | "conversion" | "pricing" | "trust" | "other";

const STATIC_ASSET = /\.(?:jpg|jpeg|png|gif|webp|svg|pdf|xml|json|css|js|zip)(?:$|\?)/i;

function representativeKind(link: FirecrawlMapLink, baseUrl: string): RepresentativeKind {
  const parsed = new URL(link.url || baseUrl, baseUrl);
  const path = parsed.pathname.toLowerCase().replace(/\/$/, "") || "/";
  const text = `${path} ${link.title || ""} ${link.description || ""}`.toLowerCase();
  if (path === "/") return "homepage";
  if (/\/(checkout|afrekenen|kassa|payment|betalen)(\/|$)/i.test(path)) return "checkout";
  if (/\/(cart|basket|bag|winkelmand|mandje)(\/|$)/i.test(path)) return "cart";
  if (/\/(contact|offerte|quote|booking|boeken|afspraak|demo|aanvraag|application|apply|signup|register|trial)(\/|$)/i.test(path)) return "conversion";
  if (/\/(products?|product|p)\//i.test(path) || /\b(product detail|artikelnummer|in winkelmand|add to cart)\b/i.test(text)) return "product";
  if (/\/(collections?|collecties?|categories?|categorie|catalogus|shop|winkel)\//i.test(path)) return "category";
  if (/\/(diensten?|services?|oplossingen?|solutions?)\//i.test(path)) return "service";
  if (/\/(pricing|prijzen|tarieven|abonnementen)(\/|$)/i.test(path)) return "pricing";
  if (/\/(delivery|shipping|bezorg|retour|returns?|garantie|guarantee|faq|veelgestelde-vragen|keurmerken?)(\/|$)/i.test(path)) return "trust";
  return "other";
}

function representativeScore(link: FirecrawlMapLink, kind: RepresentativeKind) {
  const path = new URL(link.url!).pathname;
  const depth = path.split("/").filter(Boolean).length;
  const titleBonus = link.title ? 2 : 0;
  const kindBonus: Record<RepresentativeKind, number> = {
    homepage: 100,
    checkout: 95,
    cart: 90,
    conversion: 85,
    product: 75,
    category: 70,
    service: 70,
    pricing: 65,
    trust: 55,
    other: 0,
  };
  return kindBonus[kind] + titleBonus - depth;
}

/** Selects page types needed for a representative conversion path, not a catalogue sample. */
export function selectRepresentativeUrls(baseUrl: string, links: FirecrawlMapLink[], limit = 8) {
  const base = new URL(baseUrl);
  const canonicalHome = `${base.origin}/`;
  const normalized = new Map<string, FirecrawlMapLink>();
  normalized.set(canonicalHome, { url: canonicalHome, title: "Homepage" });

  for (const link of links) {
    if (!link.url || STATIC_ASSET.test(link.url)) continue;
    try {
      const parsed = new URL(link.url, baseUrl);
      if (parsed.origin !== base.origin) continue;
      parsed.hash = "";
      parsed.search = "";
      parsed.pathname = parsed.pathname.replace(/\/$/, "") || "/";
      normalized.set(parsed.toString(), { ...link, url: parsed.toString() });
    } catch {
      continue;
    }
  }

  const buckets = new Map<RepresentativeKind, Array<FirecrawlMapLink & { url: string }>>();
  for (const link of normalized.values()) {
    if (!link.url) continue;
    const kind = representativeKind(link, baseUrl);
    const bucket = buckets.get(kind) || [];
    bucket.push(link as FirecrawlMapLink & { url: string });
    buckets.set(kind, bucket);
  }
  for (const [kind, bucket] of buckets) bucket.sort((a, b) => representativeScore(b, kind) - representativeScore(a, kind));

  const order: RepresentativeKind[] = ["homepage", "category", "service", "product", "cart", "checkout", "conversion", "pricing", "trust"];
  const selected: string[] = [];
  for (const kind of order) {
    const candidate = buckets.get(kind)?.[0];
    if (candidate && !selected.includes(candidate.url)) selected.push(candidate.url);
    if (selected.length >= limit) break;
  }
  return selected.slice(0, limit);
}

export async function crawlWebsite(url: string, apiKey: string): Promise<CrawlPage[]> {
  try {
    const mapResponse = await fetch(`${FIRECRAWL_BASE_URL}/map`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({
        url,
        sitemap: "include",
        includeSubdomains: false,
        ignoreQueryParameters: true,
        limit: 200,
        location: { country: "NL", languages: ["nl-NL", "en-US"] },
        timeout: 15_000,
      }),
      signal: AbortSignal.timeout(16_000),
    });
    if (!mapResponse.ok) throw new Error(await readError(mapResponse));
    const mapped = (await mapResponse.json()) as FirecrawlMapResponse;
    if (!mapped.success) throw new Error(mapped.error || "The website map was unavailable.");
    const selectedUrls = selectRepresentativeUrls(url, mapped.links || [], 8);
    const settled = await Promise.allSettled(selectedUrls.map((selectedUrl) => scrapePage(selectedUrl, apiKey, 12_000)));
    const pages = settled
      .filter((item): item is PromiseFulfilledResult<CrawlPage> => item.status === "fulfilled")
      .map((item) => item.value);
    if (!pages.length) throw new Error("No representative journey pages could be read.");
    return pages;
  } catch (targetedError) {
    const recovered = await Promise.allSettled([
      crawlWebsiteFallback(url, apiKey),
      scrapePage(url, apiKey, 12_000).then((page) => [page]),
    ]);
    const fallback = recovered[0];
    if (fallback.status === "fulfilled" && fallback.value.length) return fallback.value;
    const homepage = recovered[1];
    if (homepage.status === "fulfilled" && homepage.value.length) return homepage.value;
    if (fallback.status === "rejected") throw fallback.reason;
    throw targetedError;
  }
}

/**
 * Uses a Dutch public web search to select at most one commercial page from at
 * most two distinct competitor domains, then scrapes only those selected pages.
 */
export async function discoverCompetitorPages(
  entity: ResolvedCompanyEntity,
  ownUrl: string,
  apiKey: string,
): Promise<CrawlPage[]> {
  const query = buildCompetitorSearchQuery(entity);
  const response = await fetch(`${FIRECRAWL_BASE_URL}/search`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      query,
      limit: 12,
      sources: ["web"],
      country: "NL",
      location: "Netherlands",
      timeout: 6_000,
      ignoreInvalidURLs: true,
      excludeDomains: [new URL(ownUrl).hostname],
    }),
    signal: AbortSignal.timeout(7_000),
  });

  if (!response.ok) throw new Error(await readError(response));
  const result = (await response.json()) as FirecrawlSearchResponse;
  if (!result.success) throw new Error(result.error || "Competitor search was unavailable.");

  const ownOrigin = new URL(ownUrl).origin;
  const seenOrigins = new Set<string>();
  const candidates = (result.data?.web || [])
    .filter((candidate): candidate is FirecrawlSearchResult & { url: string } => Boolean(candidate.url))
    .filter((candidate) => {
      try {
        const normalized = normalizeAndValidateUrl(candidate.url);
        const parsed = new URL(normalized);
        return parsed.origin !== ownOrigin && !EXCLUDED_COMPETITOR_HOSTS.test(parsed.hostname) && !NON_COMMERCIAL_RESULT.test(parsed.pathname);
      } catch {
        return false;
      }
    })
    .map((candidate) => ({ candidate, score: competitorCandidateScore(entity, candidate) }))
    .filter((item) => item.score >= 5)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.candidate)
    .filter((candidate) => {
      const origin = new URL(candidate.url).origin;
      if (seenOrigins.has(origin)) return false;
      seenOrigins.add(origin);
      return true;
    })
    .slice(0, 2);

  const settled = await Promise.allSettled(candidates.map((candidate) => scrapePage(candidate.url, apiKey)));
  return settled
    .filter((item): item is PromiseFulfilledResult<CrawlPage> => item.status === "fulfilled")
    .map((item) => item.value)
    .filter((page) => competitorCandidateScore(entity, {
      title: page.title,
      description: `${page.description} ${page.markdown.slice(0, 1200)}`,
      url: page.url,
    }) >= 5);
}
