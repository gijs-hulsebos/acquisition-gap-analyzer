import type { CrawlPage } from "./types";
import { canonicalSiteUrl, normalizeAndValidateUrl } from "./url";

const FIRECRAWL_URL = "https://api.firecrawl.dev/v2";
const POLL_MS = 900;
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const RETRY_DELAYS = [350, 900];

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

export class FirecrawlError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly operation: "start" | "status",
  ) {
    super(message);
    this.name = "FirecrawlError";
  }
}

async function firecrawlRequest(
  operation: "start" | "status",
  request: () => Promise<Response>,
) {
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await request();
    } catch (error) {
      if (attempt < RETRY_DELAYS.length) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
        continue;
      }
      const reason = error instanceof Error ? error.message : "Network request failed.";
      throw new FirecrawlError(`Firecrawl ${operation} request failed: ${reason}`, 503, operation);
    }

    if (response.ok) return response;
    if (RETRYABLE_STATUS.has(response.status) && attempt < RETRY_DELAYS.length) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
      continue;
    }
    throw new FirecrawlError(
      `Firecrawl ${operation} request failed: ${await errorMessage(response)}`,
      response.status,
      operation,
    );
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
  const normalizedRoot = canonicalSiteUrl(rootUrl, rootUrl);
  const homepage = pages.find((page) => page.url === normalizedRoot)
    || pages.find((page) => new URL(page.url).pathname === "/")
    || [...pages].sort((a, b) => new URL(a.url).pathname.length - new URL(b.url).pathname.length)[0];
  return [homepage, ...pages
    .filter((page) => page.url !== homepage.url)
    .sort((a, b) => pageRole(b, homepage.url) - pageRole(a, homepage.url))]
    .filter((page, index, all) => all.findIndex((candidate) => candidate.url === page.url) === index)
    .slice(0, limit);
}

/** One bounded first-party crawl. No search, competitors, mapping pass or per-page scrape loop. */
export async function startWebsiteCrawl(input: string, apiKey: string, limit = 8, options: CrawlOptions = {}): Promise<WebsiteCrawlJob> {
  const normalizedInput = normalizeAndValidateUrl(input);
  const rootUrl = canonicalSiteUrl(normalizedInput, normalizedInput) || normalizedInput;
  const pageLimit = Math.min(8, Math.max(3, limit));
  const start = await firecrawlRequest("start", () => fetch(`${FIRECRAWL_URL}/crawl`, {
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
        timeout: options.scrapeTimeoutMs ?? 15_000,
      },
    }),
    signal: AbortSignal.timeout(options.startTimeoutMs ?? 7_000),
  }));
  const started = await start.json() as { success?: boolean; id?: string; error?: string };
  if (!started.success || !started.id) throw new Error(started.error || "Firecrawl did not start the crawl.");

  return { id: started.id, rootUrl, pageLimit };
}

export async function getWebsiteCrawlProgress(job: WebsiteCrawlJob, apiKey: string, pollTimeoutMs = 5_000): Promise<WebsiteCrawlProgress> {
  const response = await firecrawlRequest("status", () => fetch(`${FIRECRAWL_URL}/crawl/${job.id}`, {
    headers: headers(apiKey),
    cache: "no-store",
    signal: AbortSignal.timeout(pollTimeoutMs),
  }));
  const status = await response.json() as CrawlStatus;
  const pages = selectPages(toPages(status.data || [], job.rootUrl), job.rootUrl, job.pageLimit);
  if (status.status === "failed" || status.status === "cancelled") {
    return { status: "failed", pages, error: status.error || "The website crawl failed." };
  }
  return { status: status.status === "completed" ? "completed" : "processing", pages };
}

/** One bounded first-party crawl. No search, competitors, mapping pass or per-page scrape loop. */
export async function crawlWebsite(input: string, apiKey: string, limit = 8, options: CrawlOptions = {}): Promise<CrawlPage[]> {
  const job = await startWebsiteCrawl(input, apiKey, limit, options);

  const deadline = Date.now() + (options.deadlineMs ?? 24_000);
  let latest: CrawlPage[] = [];
  while (Date.now() < deadline) {
    const progress = await getWebsiteCrawlProgress(job, apiKey, options.pollTimeoutMs ?? 5_000);
    latest = progress.pages;
    if (progress.status === "failed") throw new Error(progress.error || "The website crawl failed.");
    if (progress.status === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  if (!latest.length) throw new Error("Firecrawl returned no readable pages within the scan time.");
  return latest;
}
