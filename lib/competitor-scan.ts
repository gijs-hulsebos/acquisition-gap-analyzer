import { buildReportFromPages } from "./report";
import type { CrawlPage, ObservedJourney, PublicCompetitor } from "./types";

/** Run the same deterministic analysis and optional wording pass used by the main report. */
export async function competitorFromPages(seedUrl: string, pages: CrawlPage[], openrouterKey?: string, observedJourney?: ObservedJourney | null): Promise<PublicCompetitor> {
  const report = await buildReportFromPages(pages, seedUrl, 0, openrouterKey, observedJourney);
  return {
    name: report.companyName,
    url: seedUrl,
    pagesAnalyzed: report.pages.length,
    score: report.score,
    estimatedClicks: report.overview.estimatedClicks,
    findings: report.gaps,
  };
}
