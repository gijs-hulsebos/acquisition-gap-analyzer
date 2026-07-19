import { analyzeCrawl } from "./analyzer";
import { enhanceFindings } from "./llm";
import type { AnalysisResult, CrawlPage } from "./types";

/** Build the deterministic report and apply the optional wording-only LLM pass. */
export async function buildReportFromPages(
  pages: CrawlPage[],
  url: string,
  processingMs: number,
  openrouterKey?: string,
): Promise<AnalysisResult> {
  const deterministic = analyzeCrawl(pages, url, processingMs);
  return enhanceFindings(deterministic, openrouterKey);
}
