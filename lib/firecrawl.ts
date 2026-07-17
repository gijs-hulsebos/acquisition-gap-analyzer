import type { CrawlPage } from "./types";
import { canonicalSiteUrl, normalizeAndValidateUrl } from "./url";

const FIRECRAWL_URL = "https://api.firecrawl.dev/v2";
const POLL_MS = 900;

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
export async function crawlWebsite(input: string, apiKey: string, limit = 8): Promise<CrawlPage[]> {
  const rootUrl = new URL(normalizeAndValidateUrl(input)).origin;
  const pageLimit = Math.min(8, Math.max(3, limit));
  const start = await fetch(`${FIRECRAWL_URL}/crawl`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      url: rootUrl,
      limit: pageLimit,
      maxDiscoveryDepth: 2,
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
        timeout: 15_000,
      },
    }),
    signal: AbortSignal.timeout(7_000),
  });
  if (!start.ok) throw new Error(await errorMessage(start));
  const started = await start.json() as { success?: boolean; id?: string; error?: string };
  if (!started.success || !started.id) throw new Error(started.error || "Firecrawl did not start the crawl.");

  const deadline = Date.now() + 24_000;
  let latest: CrawlPage[] = [];
  while (Date.now() < deadline) {
    const response = await fetch(`${FIRECRAWL_URL}/crawl/${started.id}`, {
      headers: headers(apiKey),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(await errorMessage(response));
    const status = await response.json() as CrawlStatus;
    latest = toPages(status.data || [], rootUrl);
    if (status.status === "failed" || status.status === "cancelled") {
      throw new Error(status.error || "The website crawl failed.");
    }
    if (status.status === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  if (!latest.length) throw new Error("Firecrawl returned no readable pages within the scan time.");
  return selectPages(latest, rootUrl, pageLimit);
}
