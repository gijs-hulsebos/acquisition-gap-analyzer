import { analyzeCrawl } from "./analyzer";
import { enhanceFindings } from "./llm";
import type { AnalysisResult, CrawlPage, ObservedJourney } from "./types";

/** Build the deterministic report and apply the optional wording-only LLM pass. */
export async function buildReportFromPages(
  pages: CrawlPage[],
  url: string,
  processingMs: number,
  openrouterKey?: string,
  observedJourney?: ObservedJourney | null,
): Promise<AnalysisResult> {
  const deterministic = analyzeCrawl(pages, url, processingMs, observedJourney);
  return enhanceFindings(deterministic, openrouterKey);
}
