import { analyzeCrawl } from "./analyzer";
import { enhanceFindings } from "./llm";
import type { CrawlPage, PublicCompetitor } from "./types";

/** Run the same deterministic analysis and optional wording pass used by the main report. */
export async function competitorFromPages(seedUrl: string, pages: CrawlPage[], openrouterKey?: string): Promise<PublicCompetitor> {
  const deterministic = analyzeCrawl(pages, seedUrl, 0);
  const report = await enhanceFindings(deterministic, openrouterKey);
  return {
    name: report.companyName,
    url: seedUrl,
    pagesAnalyzed: report.pages.length,
    score: report.score,
    estimatedClicks: report.overview.estimatedClicks,
    findings: report.gaps,
  };
}
