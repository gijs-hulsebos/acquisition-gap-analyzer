import type { CrawlPage, RejectedCompetitor } from "./types";
import { buildCompetitorSearchQuery, competitorCandidateScore } from "./entity";
import type { ResolvedCompanyEntity } from "./types";
import { classifyCommercialModel } from "./journey-model";
import type { CommercialModel, JourneyRole } from "./journey-model";
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

export type CompetitorSiteCrawl = {
  seedUrl: string;
  pages: CrawlPage[];
};

export type CompetitorDiscoveryResult = {
  accepted: CompetitorSiteCrawl[];
  rejected: RejectedCompetitor[];
};

const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev/v2";
const POLL_INTERVAL_MS = 1100;

export type CrawlOptions = {
  limit?: number;
  allowFallback?: boolean;
  homepageTimeout?: number;
  mapTimeout?: number;
  pageTimeout?: number;
  fallbackWait?: number;
  followLinkedJourney?: boolean;
};

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

async function crawlWebsiteFallback(url: string, apiKey: string, maxWaitMs = 9_000, limit = 8): Promise<CrawlPage[]> {
  const startResponse = await fetch(`${FIRECRAWL_BASE_URL}/crawl`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      url,
      limit,
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
    signal: AbortSignal.timeout(7_000),
  });

  if (!startResponse.ok) throw new Error(await readError(startResponse));

  const started = (await startResponse.json()) as FirecrawlStartResponse;
  if (!started.success || !started.id) {
    throw new Error(started.error || "Firecrawl did not start the crawl.");
  }

  const deadline = Date.now() + maxWaitMs;
  let latestPages: CrawlPage[] = [];
  while (Date.now() < deadline) {
    const statusResponse = await fetch(`${FIRECRAWL_BASE_URL}/crawl/${started.id}`, {
      headers: headers(apiKey),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
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

const EXCLUDED_COMPETITOR_HOSTS = /(^|\.)(facebook|instagram|linkedin|youtube|x|twitter|trustpilot|werkspot|telefoonboek|openingstijden|google|yelp|tripadvisor|pinterest|indeed|amazon|bol|marktplaats|kvk|allebedrijven|bedrijvenpagina|wikipedia|reddit|medium|startpagina|indebuurt|goudengids)\./i;
const NON_COMMERCIAL_RESULT = /\/(blog|nieuws|news|artikelen?|articles?|vacature|jobs?|privacy|voorwaarden|terms|reviews?|directory|directories|gids|lijst|top-?\d+|vergelijk|comparison|beste)(\/|$)/i;

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
  if (!result.success || !document) throw new Error(result.error || "The page could not be read.");

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

const STATIC_ASSET = /\.(?:jpg|jpeg|png|gif|webp|svg|pdf|xml|json|css|js|zip)(?:$|\?)/i;
const UTILITY_COMMERCE_PATH = /\/(?:klantenservice|customer-service|service|contact|over-ons|about|winkels?|stores?|blog|nieuws|news|inspiratie|inspiration|account|login|privacy|voorwaarden|terms|zoeken?|search)(?:\/|$)/i;
const PRICE_SIGNAL = /(?:€|eur\s*)\s*\d{1,5}(?:[.,]\d{2})?|\b\d{1,4}[,.]\d{2}\b/i;

function representativeKind(link: FirecrawlMapLink, baseUrl: string): JourneyRole {
  const parsed = new URL(link.url || baseUrl, baseUrl);
  const path = parsed.pathname.toLowerCase().replace(/\/$/, "") || "/";
  const text = `${path} ${link.title || ""} ${link.description || ""}`.toLowerCase();
  if (path === "/") return "homepage";
  if (/\/(checkout|afrekenen|kassa|payment|betalen)(\/|$)/i.test(path)) return "checkout";
  if (/\/(cart|basket|bag|winkelmand|mandje)(\/|$)/i.test(path)) return "cart";
  if (/\/(booking|boeken|afspraak|demo|aanvraag|application|apply|signup|register|trial)(\/|$)/i.test(path)) return "conversion";
  if (/\/(products?|product|p|artikel|item)(\/|$)/i.test(path) || /\b(product detail|artikelnummer|in winkelmand|add to cart|sku)\b/i.test(text) || (PRICE_SIGNAL.test(text) && path.split("/").filter(Boolean).length >= 2)) return "product";
  if (/\/(collections?|collecties?|categories?|categorie|catalogus|shop|winkel|assortiment|search|zoeken?|zoekresultaten?)(\/|$)/i.test(path) || /\b(collectie|categorie|assortiment|shop all|bekijk alles|zoekresultaten)\b/i.test(text)) return "category";
  if (/\/(diensten?|services?|oplossingen?|solutions?)(\/|$)/i.test(path)) return "service";
  if (/\/(pricing|prijzen|tarieven|abonnementen)(\/|$)/i.test(path)) return "pricing";
  return "other";
}

function representativeScore(link: FirecrawlMapLink, kind: JourneyRole) {
  const path = new URL(link.url!).pathname;
  const depth = path.split("/").filter(Boolean).length;
  const titleBonus = link.title ? 2 : 0;
  const kindBonus: Record<JourneyRole, number> = {
    homepage: 100,
    checkout: 95,
    cart: 90,
    conversion: 85,
    product: 75,
    category: 70,
    service: 70,
    pricing: 65,
    other: 0,
  };
  return kindBonus[kind] + titleBonus - depth;
}

function normalizedInternalLinks(page: CrawlPage, baseUrl: string) {
  const origin = new URL(baseUrl).origin;
  const htmlLinks = Array.from(page.html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)).map((match) => match[1]);
  return new Set([...page.links, ...htmlLinks].flatMap((raw) => {
    try {
      const parsed = new URL(raw, page.url);
      if (parsed.origin !== origin) return [];
      parsed.hash = "";
      parsed.search = "";
      parsed.pathname = parsed.pathname.replace(/\/$/, "") || "/";
      return [parsed.toString()];
    } catch {
      return [];
    }
  }));
}

function journeyBuckets(baseUrl: string, links: FirecrawlMapLink[]) {
  const buckets = new Map<JourneyRole, Array<FirecrawlMapLink & { url: string }>>();
  for (const link of links) {
    if (!link.url || STATIC_ASSET.test(link.url)) continue;
    try {
      const parsed = new URL(link.url, baseUrl);
      if (parsed.origin !== new URL(baseUrl).origin) continue;
      parsed.hash = "";
      parsed.search = "";
      parsed.pathname = parsed.pathname.replace(/\/$/, "") || "/";
      const normalized = { ...link, url: parsed.toString() };
      const role = representativeKind(normalized, baseUrl);
      const bucket = buckets.get(role) || [];
      if (!bucket.some((item) => item.url === normalized.url)) bucket.push(normalized);
      buckets.set(role, bucket);
    } catch {
      continue;
    }
  }
  for (const [role, bucket] of buckets) bucket.sort((a, b) => representativeScore(b, role) - representativeScore(a, role));
  return buckets;
}

function chooseJourneyCandidate(
  role: JourneyRole,
  currentPage: CrawlPage,
  buckets: Map<JourneyRole, Array<FirecrawlMapLink & { url: string }>>,
  baseUrl: string,
  visited: Set<string>,
) {
  const linked = normalizedInternalLinks(currentPage, baseUrl);
  const candidates = (buckets.get(role) || []).filter((item) => !visited.has(item.url));
  const explicit = candidates.find((item) => linked.has(item.url)) || candidates[0];
  if (explicit) return explicit;
  const direct = [...linked]
    .filter((url) => !visited.has(url) && !STATIC_ASSET.test(url))
    .map((url) => ({ url, title: "", description: "" }))
    .find((item) => representativeKind(item, baseUrl) === role);
  if (direct) return direct;
  if (role !== "category" && role !== "product") return null;

  const currentDepth = new URL(currentPage.url).pathname.split("/").filter(Boolean).length;
  const fallbacks = (buckets.get("other") || [])
    .filter((item) => !visited.has(item.url) && !UTILITY_COMMERCE_PATH.test(new URL(item.url).pathname))
    .map((item) => {
      const path = new URL(item.url).pathname;
      const depth = path.split("/").filter(Boolean).length;
      const text = `${item.title || ""} ${item.description || ""} ${path}`;
      const linkedScore = linked.has(item.url) ? 30 : 0;
      const roleScore = role === "product"
        ? (PRICE_SIGNAL.test(text) ? 25 : 0) + (/\b(product|artikel|sku|bestel)\b/i.test(text) ? 16 : 0) + (depth > currentDepth ? 8 : 0)
        : (/\b(categorie|collectie|assortiment|wonen|keuken|tuin|kleding|diensten|oplossingen)\b/i.test(text) ? 18 : 0) + (depth >= 1 && depth <= currentDepth + 2 ? 8 : 0);
      return { item, score: linkedScore + roleScore - depth };
    })
    .filter(({ score }) => score >= (role === "product" ? 20 : 10))
    .sort((a, b) => b.score - a.score);
  return fallbacks[0]?.item || null;
}

function representativePlan(model: CommercialModel): JourneyRole[] {
  if (model === "ecommerce") return ["category", "product", "cart", "checkout"];
  if (model === "booking") return ["service", "service", "conversion", "pricing"];
  if (model === "software") return ["pricing", "service", "conversion"];
  if (model === "marketplace") return ["category", "product", "conversion", "pricing"];
  if (model === "service") return ["service", "service", "conversion", "pricing"];
  return ["service", "conversion", "pricing"];
}

export function selectRepresentativeResults(pages: CrawlPage[], baseUrl: string, limit = 8) {
  const ownOrigin = new URL(baseUrl).origin;
  const seen = new Set<string>();
  const unique = pages.filter((page) => {
    try {
      const normalized = normalizeAndValidateUrl(page.url);
      if (new URL(normalized).origin !== ownOrigin || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    } catch {
      return false;
    }
  });
  if (!unique.length) return [];
  const homepage = [...unique].sort((a, b) => new URL(a.url).pathname.length - new URL(b.url).pathname.length)[0];
  const model = classifyCommercialModel(unique);
  const selected = [homepage];
  const used = new Set([normalizeAndValidateUrl(homepage.url)]);
  for (const role of representativePlan(model)) {
    const candidate = unique.find((page) => !used.has(normalizeAndValidateUrl(page.url)) && representativeKind({
      url: page.url,
      title: page.title,
      description: `${page.description} ${page.markdown.slice(0, 900)} ${page.html.slice(0, 1400)}`,
    }, homepage.url) === role);
    if (!candidate) continue;
    selected.push(candidate);
    used.add(normalizeAndValidateUrl(candidate.url));
    if (selected.length >= limit) break;
  }
  return selected.slice(0, limit);
}

async function crawlRepresentativePages(
  homepage: CrawlPage,
  mappedLinks: FirecrawlMapLink[],
  model: CommercialModel,
  apiKey: string,
  limit = 8,
  pageTimeout = 5_500,
  followLinkedJourney = true,
) {
  const pages = [homepage];
  const visited = new Set([normalizeAndValidateUrl(homepage.url)]);
  const buckets = journeyBuckets(homepage.url, mappedLinks);
  const roles = representativePlan(model);

  if (followLinkedJourney && (model === "ecommerce" || model === "marketplace")) {
    let current = homepage;
    for (const role of ["category", "product"] as JourneyRole[]) {
      if (pages.length >= limit) break;
      const candidate = chooseJourneyCandidate(role, current, buckets, homepage.url, visited);
      if (!candidate) continue;
      visited.add(candidate.url);
      try {
        const page = await scrapePage(candidate.url, apiKey, pageTimeout);
        pages.push(page);
        current = page;
      } catch {
        continue;
      }
    }

    const remaining: Array<FirecrawlMapLink & { url: string }> = [];
    for (const role of roles.filter((role) => role !== "category" && role !== "product")) {
      const candidate = chooseJourneyCandidate(role, current, buckets, homepage.url, visited);
      if (!candidate) continue;
      remaining.push(candidate);
      visited.add(candidate.url);
      if (pages.length + remaining.length >= limit) break;
    }
    const settled = await Promise.allSettled(remaining.map((candidate) => scrapePage(candidate.url, apiKey, pageTimeout)));
    pages.push(...settled.filter((item): item is PromiseFulfilledResult<CrawlPage> => item.status === "fulfilled").map((item) => item.value));
    return selectRepresentativeResults(pages, homepage.url, limit);
  }

  const candidates: Array<FirecrawlMapLink & { url: string }> = [];

  for (const role of roles) {
    const candidate = chooseJourneyCandidate(role, homepage, buckets, homepage.url, visited);
    if (!candidate) continue;
    candidates.push(candidate);
    visited.add(candidate.url);
    if (candidates.length >= limit - 1) break;
  }

  const settled = await Promise.allSettled(candidates.map((candidate) => scrapePage(candidate.url, apiKey, pageTimeout)));
  pages.push(...settled.filter((item): item is PromiseFulfilledResult<CrawlPage> => item.status === "fulfilled").map((item) => item.value));
  return selectRepresentativeResults(pages, homepage.url, limit);
}

export async function crawlWebsite(url: string, apiKey: string, options: CrawlOptions = {}): Promise<CrawlPage[]> {
  const rootUrl = new URL(normalizeAndValidateUrl(url)).origin;
  const limit = Math.min(8, Math.max(1, options.limit ?? 8));
  const allowFallback = options.allowFallback ?? true;
  const homepageTimeout = options.homepageTimeout ?? 6_000;
  const mapTimeout = options.mapTimeout ?? 5_000;
  const pageTimeout = options.pageTimeout ?? 4_000;
  const followLinkedJourney = options.followLinkedJourney ?? true;
  let homepage: CrawlPage;

  try {
    homepage = await scrapePage(rootUrl, apiKey, homepageTimeout);
  } catch (homepageError) {
    if (!allowFallback) throw homepageError;
    const fallback = await crawlWebsiteFallback(rootUrl, apiKey, options.fallbackWait ?? 9_000, limit);
    return selectRepresentativeResults(fallback, rootUrl, limit);
  }

  try {
    const mapResponse = await fetch(`${FIRECRAWL_BASE_URL}/map`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({
        url: rootUrl,
        sitemap: "include",
        includeSubdomains: false,
        ignoreQueryParameters: true,
        limit: 200,
        location: { country: "NL", languages: ["nl-NL", "en-US"] },
        timeout: mapTimeout,
      }),
      signal: AbortSignal.timeout(mapTimeout + 1_000),
    });
    if (!mapResponse.ok) return [homepage];
    const mapped = (await mapResponse.json()) as FirecrawlMapResponse;
    if (!mapped.success) return [homepage];
    const model = classifyCommercialModel([homepage]);
    const pages = await crawlRepresentativePages(homepage, mapped.links || [], model, apiKey, limit, pageTimeout, followLinkedJourney);
    return pages;
  } catch {
    return [homepage];
  }
}

/**
 * Uses a Dutch public web search to select up to two direct competitors and
 * crawls a bounded representative page set for each accepted domain.
 */
export async function discoverCompetitorPages(
  entity: ResolvedCompanyEntity,
  ownUrl: string,
  apiKey: string,
): Promise<CompetitorDiscoveryResult> {
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
      timeout: 4_500,
      ignoreInvalidURLs: true,
      excludeDomains: [new URL(ownUrl).hostname],
    }),
    signal: AbortSignal.timeout(5_500),
  });

  if (!response.ok) throw new Error(await readError(response));
  const result = (await response.json()) as FirecrawlSearchResponse;
  if (!result.success) throw new Error(result.error || "Competitor search was unavailable.");

  const ownOrigin = new URL(ownUrl).origin;
  const seenOrigins = new Set<string>();
  const rejected: RejectedCompetitor[] = [];
  const companyKey = entity.companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const ownDomainKey = entity.domain.toLowerCase().replace(/^www\./, "").split(".").slice(0, -1).join("").replace(/[^a-z0-9]/g, "");
  const ranked: Array<{ candidate: FirecrawlSearchResult & { url: string }; score: number }> = [];

  for (const candidate of (result.data?.web || []).filter((item): item is FirecrawlSearchResult & { url: string } => Boolean(item.url))) {
    const name = candidate.title?.slice(0, 100) || candidate.url.slice(0, 100);
    let parsed: URL;
    try {
      parsed = new URL(normalizeAndValidateUrl(candidate.url));
    } catch {
      rejected.push({ name, url: candidate.url, reason: "Invalid or unsafe public URL.", crawled: false });
      continue;
    }
    const origin = parsed.origin;
    const candidateDomainKey = parsed.hostname.replace(/^www\./, "").split(".").slice(0, -1).join("").replace(/[^a-z0-9]/g, "");
    const titleKey = (candidate.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (EXCLUDED_COMPETITOR_HOSTS.test(parsed.hostname) || NON_COMMERCIAL_RESULT.test(parsed.pathname)) {
      rejected.push({ name, url: candidate.url, reason: "Directory, blog, review site or other non-commercial result.", crawled: false });
      continue;
    }
    if (origin === ownOrigin || (ownDomainKey.length >= 5 && candidateDomainKey === ownDomainKey) || (companyKey.length >= 6 && titleKey.includes(companyKey))) {
      rejected.push({ name, url: candidate.url, reason: "Same company or a regional version of the submitted company.", crawled: false });
      continue;
    }
    if (/\.(be|de|fr|uk|co\.uk)$/i.test(parsed.hostname) && !/\b(nederland|netherlands|nederlandse)\b/i.test(`${candidate.title} ${candidate.description}`)) {
      rejected.push({ name, url: candidate.url, reason: "Different country market.", crawled: false });
      continue;
    }
    if (seenOrigins.has(origin)) {
      rejected.push({ name, url: candidate.url, reason: "Duplicate result from a domain already evaluated.", crawled: false });
      continue;
    }
    seenOrigins.add(origin);
    const score = competitorCandidateScore(entity, candidate);
    if (score < 5) {
      rejected.push({ name, url: candidate.url, reason: "Insufficient industry, offer, geography or target-customer match.", crawled: false });
      continue;
    }
    ranked.push({ candidate, score });
  }

  ranked.sort((a, b) => b.score - a.score);
  const candidates = ranked.slice(0, 2).map((item) => item.candidate);
  for (const item of ranked.slice(2)) {
    rejected.push({ name: item.candidate.title || new URL(item.candidate.url).hostname, url: item.candidate.url, reason: "Lower-ranked matching result; only two competitors are included.", crawled: false });
  }

  const settled = await Promise.allSettled(candidates.map(async (candidate): Promise<CompetitorSiteCrawl> => {
    const origin = new URL(candidate.url).origin;
    const pages = await crawlWebsite(origin, apiKey, {
      limit: 8,
      allowFallback: false,
      homepageTimeout: 3_500,
      mapTimeout: 3_500,
      pageTimeout: 3_000,
      followLinkedJourney: true,
    });
    return { seedUrl: candidate.url, pages };
  }));

  const accepted: CompetitorSiteCrawl[] = [];
  settled.forEach((item, index) => {
    const candidate = candidates[index];
    if (item.status === "rejected") {
      rejected.push({ name: candidate.title || new URL(candidate.url).hostname, url: candidate.url, reason: "The accepted competitor domain could not be read within the crawl budget.", crawled: true });
      return;
    }
    const site = item.value;
      const aggregate = site.pages.map((page) => `${page.title} ${page.description} ${page.markdown.slice(0, 1200)}`).join(" ");
      const model = classifyCommercialModel(site.pages);
      const modelMatches = entity.businessModel === "retail-ecommerce"
        ? model === "ecommerce" || model === "marketplace"
        : entity.businessModel === "software-technology"
          ? model === "software"
          : entity.businessModel === "local-service" || entity.businessModel === "professional-service"
            ? model === "service" || model === "booking"
            : true;
      const geographyTokens = entity.geography.toLowerCase() === "nederland" ? [] : entity.geography.toLowerCase().split(/\s+/).filter((token) => token.length >= 4);
      const sameGeography = !geographyTokens.length || geographyTokens.some((token) => aggregate.toLowerCase().includes(token));
      const target = entity.targetCustomer.toLowerCase();
      const candidateBusiness = /\b(b2b|bedrijven|zakelijk|ondernemers|organisaties|professionals)\b/i.test(aggregate);
      const candidateConsumer = /\b(b2c|particulieren|consumenten|woningeigenaren|gezinnen|thuis)\b/i.test(aggregate);
      const differentTargetMarket = /\b(bedrijven|zakelijk|b2b)\b/i.test(target) && candidateConsumer && !candidateBusiness
        || /\b(particulieren|consumenten|b2c)\b/i.test(target) && candidateBusiness && !candidateConsumer;
      const finalScore = competitorCandidateScore(entity, {
        title: site.pages[0]?.title,
        description: aggregate,
        url: site.seedUrl,
      });
    if (!site.pages.length || !modelMatches || !sameGeography || differentTargetMarket || finalScore < 5) {
      rejected.push({ name: candidate.title || new URL(candidate.url).hostname, url: candidate.url, reason: !modelMatches ? "Crawled evidence indicates a different business model." : !sameGeography ? "Crawled evidence indicates a different geographic market." : differentTargetMarket ? "Crawled evidence indicates a different target customer." : "Crawled evidence did not confirm sufficient industry and offer overlap.", crawled: true });
      return;
    }
    accepted.push(site);
  });

  return { accepted: accepted.slice(0, 2), rejected };
}
