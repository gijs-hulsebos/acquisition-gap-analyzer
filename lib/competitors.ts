import { analyzeCrawl, detectTrustSignals } from "./analyzer";
import type { CompetitorSiteCrawl } from "./firecrawl";
import type {
  AnalysisResult,
  CrawlPage,
  Evidence,
  Gap,
  PublicSearchCompetitor,
  ResolvedCompanyEntity,
} from "./types";

function competitorEvidence(evidence: Evidence): Evidence {
  return { ...evidence, source: "competitor" };
}

function analyzedOrigin(pages: CrawlPage[]) {
  return new URL(pages[0].url).origin;
}

/** Runs the exact same deterministic analyzer used for the submitted company. */
export function analyzeCompetitorSite(
  site: CompetitorSiteCrawl,
  _identity: string | ResolvedCompanyEntity,
): PublicSearchCompetitor {
  const deterministic = analyzeCrawl(site.pages, analyzedOrigin(site.pages), 0);
  const findings: Gap[] = deterministic.gaps.map((finding) => ({
    ...finding,
    evidence: finding.evidence.map(competitorEvidence),
  }));
  const offer = findings.find((finding) => finding.id === "offer-clarity")!;
  const cta = findings.find((finding) => finding.id === "cta-clarity")!;
  const path = findings.find((finding) => finding.id === "customer-journey-path")!;
  const trustSignals = Array.from(new Set(site.pages.flatMap((page) => detectTrustSignals(`${page.markdown} ${page.description}`, page.html))));
  const primaryEvidence = (finding: Gap) => finding.evidence[0] || {
    statement: finding.summary,
    pageLabel: "Representative competitor crawl",
    url: site.seedUrl,
    source: "competitor" as const,
  };

  return {
    name: deterministic.companyName,
    url: analyzedOrigin(site.pages),
    pageTitle: site.pages[0]?.title || deterministic.companyName,
    label: "Likely public search competitor",
    dedicatedServicePage: deterministic.pages.some((page) => page.type === "Service" || page.type === "Category" || page.type === "Product"),
    ctaClarity: cta.score,
    conversionPathSteps: deterministic.overview.estimatedClicks,
    pagesAnalyzed: deterministic.stats.pagesCrawled,
    dataStatus: deterministic.readiness.status,
    trustSignals,
    findings,
    metrics: [
      { label: "Offer Clarity", value: offer.score === null ? "Insufficient data" : `${offer.score}/100`, evidence: primaryEvidence(offer) },
      { label: "CTA clarity", value: cta.score === null ? "Insufficient data" : `${cta.score}/100`, evidence: primaryEvidence(cta) },
      { label: "Customer Journey Path", value: path.score === null ? "Insufficient data" : deterministic.overview.estimatedClicks === null ? "Unconfirmed" : `${deterministic.overview.estimatedClicks} click${deterministic.overview.estimatedClicks === 1 ? "" : "s"}`, evidence: primaryEvidence(path) },
    ],
  };
}

/** Backwards-compatible helper for a single-page test or fixture. */
export function analyzeCompetitorPage(page: CrawlPage, identity: string | ResolvedCompanyEntity) {
  return analyzeCompetitorSite({ seedUrl: page.url, pages: [page] }, identity);
}

function comparisonEvidence(competitor: PublicSearchCompetitor, finding: Gap, analyzedScore: number): Evidence {
  return {
    statement: `Likely public search competitor ${competitor.name}: ${finding.title} scored ${finding.score}/100 from ${competitor.pagesAnalyzed} representative pages, compared with ${analyzedScore}/100 for the analyzed company.`,
    pageLabel: "Representative competitor crawl",
    url: competitor.url,
    source: "competitor",
  };
}

function normalizeSites(input: CompetitorSiteCrawl[] | CrawlPage[]): CompetitorSiteCrawl[] {
  return input.map((item) => "pages" in item ? item : { seedUrl: item.url, pages: [item] });
}

/** Adds comparison evidence only to deterministic findings that already exist. */
export function applyCompetitorAnalysis(result: AnalysisResult, crawls: CompetitorSiteCrawl[] | CrawlPage[]): AnalysisResult {
  const competitors = normalizeSites(crawls).slice(0, 2).map((site) => analyzeCompetitorSite(site, result.competitors.entity));

  const gaps = result.gaps.map((gap) => {
    if (gap.score === null) return gap;
    const stronger = competitors
      .map((competitor) => ({ competitor, finding: competitor.findings.find((item) => item.id === gap.id) }))
      .find((item) => item.finding?.score !== null && item.finding!.score! >= gap.score! + 10);
    if (!stronger?.finding || stronger.finding.score === null) return gap;
    return { ...gap, evidence: [...gap.evidence, comparisonEvidence(stronger.competitor, stronger.finding, gap.score)] };
  });

  return {
    ...result,
    gaps,
    competitors: {
      ...result.competitors,
      status: competitors.length ? "available" : "not-found",
      note: competitors.length
        ? `Resolved ${result.competitors.entity.companyName} as ${result.competitors.entity.industry}. Each accepted likely public search competitor was checked with the same three deterministic findings across representative pages.`
        : `No direct public-search competitor sufficiently matched the resolved ${result.competitors.entity.industry}, market and customer profile. The main report is unaffected.`,
      competitors,
    },
  };
}
