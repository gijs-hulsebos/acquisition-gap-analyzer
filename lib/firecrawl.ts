import type { CrawlPage } from "./types";
import { canonicalSiteUrl, normalizeAndValidateUrl } from "./url";

const FIRECRAWL_URL = "https://api.firecrawl.dev/v2";
const POLL_MS = 650;

export type CrawlOptions = {
  deadlineMs?: number;
  maxDiscoveryDepth?: number;
  pollTimeoutMs?: number;
  scrapeTimeoutMs?: number;
  startTimeoutMs?: number;
};

type FirecrawlDocument = {
  markdown?: string;
  html?: string;
  links?: string[];
  metadata?: {
    url?: string;
    sourceURL?: string;
    title?: string;
    description?: string;
    statusCode?: number;
  };
};

type CrawlStatus = {
  status?: "scraping" | "completed" | "failed" | "cancelled";
  data?: FirecrawlDocument[];
  error?: string;
};

function isTransientFirecrawlError(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /abort|timeout|timed out|fetch failed|network|429|500|502|503|504/i.test(message);
}

async function pause(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

type ScrapeStatus = {
  success?: boolean;
  data?: FirecrawlDocument;
  error?: string;
};

export type WebsiteCrawlJob = {
  id: string;
  rootUrl: string;
  pageLimit: number;
};

export type WebsiteCrawlProgress = {
  status: "processing" | "completed" | "failed";
  pages: CrawlPage[];
  error?: string;
};

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

function toPages(documents: FirecrawlDocument[], baseUrl: string): CrawlPage[] {
  const seen = new Set<string>();
  return documents.flatMap((document) => {
    const rawUrl = document.metadata?.sourceURL || document.metadata?.url;
    if (!rawUrl) return [];
    const url = canonicalSiteUrl(rawUrl, baseUrl);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{
      url,
      title: document.metadata?.title?.trim() || "Untitled page",
      description: document.metadata?.description?.trim() || "",
      markdown: document.markdown || "",
      html: document.html || "",
      links: document.links || [],
      statusCode: document.metadata?.statusCode || 200,
    }];
  });
}

function pageRole(page: CrawlPage, homepageUrl: string) {
  if (page.url === homepageUrl) return 100;
  const value = `${new URL(page.url).pathname} ${page.title}`.toLowerCase();
  if (/checkout|afrekenen|kassa|payment|betalen/.test(value)) return 95;
  if (/cart|basket|bag|winkelmand|winkelwagen|mandje/.test(value)) return 90;
  if (/product|artikel|item|\/p\//.test(value)) return 85;
  if (/categor|collect|shop|winkel|assortiment|search|zoek/.test(value)) return 80;
  if (/service|dienst|oplossing|pricing|prijzen|tarieven|contact|booking|boeken/.test(value)) return 75;
  return 20;
}

function selectPages(pages: CrawlPage[], rootUrl: string, limit: number) {
  if (!pages.length) return [];
  const homepage = pages.find((page) => new URL(page.url).pathname === "/")
    || [...pages].sort((a, b) => new URL(a.url).pathname.length - new URL(b.url).pathname.length)[0];
  return [homepage, ...pages
    .filter((page) => page.url !== homepage.url)
    .sort((a, b) => pageRole(b, homepage.url) - pageRole(a, homepage.url))]
    .filter((page, index, all) => all.findIndex((candidate) => candidate.url === page.url) === index)
    .slice(0, limit);
}

/** One bounded first-party crawl. No search, competitors, mapping pass or per-page scrape loop. */
export async function startWebsiteCrawl(input: string, apiKey: string, limit = 8, options: CrawlOptions = {}): Promise<WebsiteCrawlJob> {
  const rootUrl = normalizeAndValidateUrl(input);
  const pageLimit = Math.min(8, Math.max(3, limit));
  const start = await fetch(`${FIRECRAWL_URL}/crawl`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      url: rootUrl,
      limit: pageLimit,
      maxDiscoveryDepth: options.maxDiscoveryDepth ?? 2,
      crawlEntireDomain: true,
      allowExternalLinks: false,
      allowSubdomains: false,
      sitemap: "include",
      ignoreQueryParameters: true,
      prompt: "Crawl representative first-party conversion pages only: homepage, category or service listing, product or service detail, cart, checkout, booking or contact. Avoid blogs, legal pages and repeated products.",
      excludePaths: ["blog/.*", "nieuws/.*", "news/.*", "privacy.*", "voorwaarden.*", "terms.*", "account/.*", "login.*"],
      scrapeOptions: {
        formats: ["markdown", "html", "links"],
        onlyMainContent: false,
        blockAds: true,
        removeBase64Images: true,
        timeout: options.scrapeTimeoutMs ?? 30_000,
      },
    }),
    signal: AbortSignal.timeout(options.startTimeoutMs ?? 10_000),
  });
  if (!start.ok) throw new Error(await errorMessage(start));
  const started = await start.json() as { success?: boolean; id?: string; error?: string };
  if (!started.success || !started.id) throw new Error(started.error || "Firecrawl did not start the crawl.");

  return { id: started.id, rootUrl, pageLimit };
}

/** Exact-page fallback for crawls that complete without returning readable documents. */
export async function scrapeWebsitePage(input: string, apiKey: string, timeoutMs = 15_000): Promise<CrawlPage | null> {
  const url = normalizeAndValidateUrl(input);
  const response = await fetch(`${FIRECRAWL_URL}/scrape`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      url,
      formats: ["markdown", "html", "links"],
      onlyMainContent: false,
      blockAds: true,
      removeBase64Images: true,
      timeout: timeoutMs,
    }),
    signal: AbortSignal.timeout(timeoutMs + 1_000),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const scraped = await response.json() as ScrapeStatus;
  if (!scraped.success || !scraped.data) return null;
  return toPages([scraped.data], url)[0] || null;
}

export async function getWebsiteCrawlProgress(job: WebsiteCrawlJob, apiKey: string, pollTimeoutMs = 8_000): Promise<WebsiteCrawlProgress> {
  const response = await fetch(`${FIRECRAWL_URL}/crawl/${job.id}`, {
    headers: headers(apiKey),
    cache: "no-store",
    signal: AbortSignal.timeout(pollTimeoutMs),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const status = await response.json() as CrawlStatus;
  const pages = selectPages(toPages(status.data || [], job.rootUrl), job.rootUrl, job.pageLimit);
  if (status.status === "failed" || status.status === "cancelled") {
    return { status: "failed", pages, error: status.error || "The website crawl failed." };
  }
  return { status: status.status === "completed" ? "completed" : "processing", pages };
}

/** One bounded first-party crawl. No search, competitors, mapping pass or per-page scrape loop. */
export async function crawlWebsite(input: string, apiKey: string, limit = 8, options: CrawlOptions = {}): Promise<CrawlPage[]> {
  const startedAt = Date.now();
  const deadline = startedAt + (options.deadlineMs ?? 38_000);
  let job: WebsiteCrawlJob | null = null;
  let startError: unknown = null;

  for (let attempt = 0; attempt < 2 && Date.now() < deadline - 4_000; attempt += 1) {
    try {
      job = await startWebsiteCrawl(input, apiKey, limit, {
        ...options,
        startTimeoutMs: Math.min(options.startTimeoutMs ?? 10_000, Math.max(3_000, deadline - Date.now() - 3_000)),
      });
      break;
    } catch (error) {
      startError = error;
      if (!isTransientFirecrawlError(error) || attempt === 1) break;
      await pause(350);
    }
  }

  if (!job) {
    try {
      const remaining = Math.max(3_000, Math.min(12_000, deadline - Date.now() - 1_000));
      const fallback = await scrapeWebsitePage(input, apiKey, remaining);
      if (fallback) return [fallback];
    } catch (fallbackError) {
      if (!isTransientFirecrawlError(fallbackError)) throw fallbackError;
    }
    if (startError && !isTransientFirecrawlError(startError)) throw startError;
    throw new Error("Firecrawl did not return website evidence within the scan time. Please try again.");
  }

  let latest: CrawlPage[] = [];
  while (Date.now() < deadline) {
    try {
      const remaining = deadline - Date.now();
      const progress = await getWebsiteCrawlProgress(job, apiKey, Math.min(options.pollTimeoutMs ?? 8_000, Math.max(2_000, remaining)));
      if (progress.pages.length >= latest.length) latest = progress.pages;
      if (progress.status === "failed") throw new Error(progress.error || "The website crawl failed.");
      if (progress.status === "completed" || latest.length >= job.pageLimit) break;
    } catch (error) {
      if (!isTransientFirecrawlError(error)) throw error;
      // A slow status request must not discard an otherwise healthy asynchronous crawl.
    }
    if (Date.now() < deadline - POLL_MS) await pause(POLL_MS);
  }

  if (!latest.length) {
    try {
      const remaining = Math.max(2_500, Math.min(10_000, deadline - Date.now() - 500));
      const fallback = await scrapeWebsitePage(input, apiKey, remaining);
      if (fallback) return [fallback];
    } catch (error) {
      if (!isTransientFirecrawlError(error)) throw error;
    }
    throw new Error("Firecrawl returned no readable pages within the scan time. Please try again.");
  }
  return latest;
}
