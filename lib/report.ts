import { analyzeCrawl } from "./analyzer";
import { enhanceFindings } from "./llm";
import { crawlWebsite } from "./firecrawl";
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

/** The single analysis pipeline used by company and competitor scans. */
export async function analyzeWebsite(
  url: string,
  firecrawlKey: string,
  openrouterKey?: string,
): Promise<AnalysisResult> {
  const startedAt = Date.now();
  const pages = await crawlWebsite(url, firecrawlKey);
  return buildReportFromPages(pages, url, Date.now() - startedAt, openrouterKey);
}
