import type { CrawlPage } from "./types";
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

const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev/v2";
const POLL_INTERVAL_MS = 1100;
const MAX_WAIT_MS = 32_000;

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

export async function crawlWebsite(url: string, apiKey: string): Promise<CrawlPage[]> {
  const startResponse = await fetch(`${FIRECRAWL_BASE_URL}/crawl`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      url,
      limit: 8,
      maxDiscoveryDepth: 2,
      crawlEntireDomain: true,
      allowExternalLinks: false,
      allowSubdomains: false,
      sitemap: "include",
      ignoreQueryParameters: true,
      scrapeOptions: {
        formats: ["markdown", "html", "links"],
        onlyMainContent: false,
        blockAds: true,
        removeBase64Images: true,
        timeout: 20_000,
      },
    }),
    signal: AbortSignal.timeout(25_000),
  });

  if (!startResponse.ok) throw new Error(await readError(startResponse));

  const started = (await startResponse.json()) as FirecrawlStartResponse;
  if (!started.success || !started.id) {
    throw new Error(started.error || "Firecrawl did not start the crawl.");
  }

  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const statusResponse = await fetch(`${FIRECRAWL_BASE_URL}/crawl/${started.id}`, {
      headers: headers(apiKey),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    if (!statusResponse.ok) throw new Error(await readError(statusResponse));
    const result = (await statusResponse.json()) as FirecrawlStatusResponse;

    if (result.status === "failed" || result.status === "cancelled") {
      throw new Error(result.error || "The website crawl could not be completed.");
    }

    if (result.status === "completed") {
      const pages = (result.data || [])
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

      if (!pages.length) throw new Error("The crawl completed but returned no readable pages.");
      return pages;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error("The crawl took too long. Try the website again in a moment.");
}

const EXCLUDED_COMPETITOR_HOSTS = /(^|\.)(facebook|instagram|linkedin|youtube|x|twitter|trustpilot|werkspot|telefoonboek|openingstijden|google)\./i;
const NON_COMMERCIAL_RESULT = /\/(blog|nieuws|news|vacature|jobs?|privacy|voorwaarden|terms)(\/|$)/i;

function relevanceTerms(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-zà-ÿ0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((term) => term.length >= 4)
    .slice(0, 8);
}

function candidateScore(candidate: FirecrawlSearchResult, terms: string[]) {
  if (!candidate.url) return -100;
  const haystack = `${candidate.title || ""} ${candidate.description || ""} ${candidate.url}`.toLowerCase();
  const termMatches = terms.filter((term) => haystack.includes(term)).length;
  const path = new URL(candidate.url).pathname;
  return termMatches * 3 + (path !== "/" ? 2 : 0) + (/\/(diensten?|services?|oplossingen?|offerte|aanbod)\//i.test(path) ? 4 : 0);
}

async function scrapeCommercialPage(url: string, apiKey: string): Promise<CrawlPage> {
  const response = await fetch(`${FIRECRAWL_BASE_URL}/scrape`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      url,
      formats: ["markdown", "html", "links"],
      onlyMainContent: false,
      blockAds: true,
      removeBase64Images: true,
      timeout: 8_000,
    }),
    signal: AbortSignal.timeout(9_000),
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

/**
 * Uses a Dutch public web search to select at most one commercial page from at
 * most two distinct competitor domains, then scrapes only those selected pages.
 */
export async function discoverCompetitorPages(
  query: string,
  ownUrl: string,
  apiKey: string,
): Promise<CrawlPage[]> {
  const response = await fetch(`${FIRECRAWL_BASE_URL}/search`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      query,
      limit: 8,
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
  const terms = relevanceTerms(query);
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
    .sort((a, b) => candidateScore(b, terms) - candidateScore(a, terms))
    .filter((candidate) => {
      const origin = new URL(candidate.url).origin;
      if (seenOrigins.has(origin)) return false;
      seenOrigins.add(origin);
      return true;
    })
    .slice(0, 2);

  const settled = await Promise.allSettled(candidates.map((candidate) => scrapeCommercialPage(candidate.url, apiKey)));
  return settled
    .filter((item): item is PromiseFulfilledResult<CrawlPage> => item.status === "fulfilled")
    .map((item) => item.value);
}
