import { analyzeCrawl } from "./analyzer";
import { enhanceFindings } from "./llm";
import { crawlWebsite } from "./firecrawl";
import { verifyCustomerJourney } from "./journey-verifier";
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

/** The single analysis pipeline used by company and competitor scans. */
export async function analyzeWebsite(
  url: string,
  firecrawlKey: string,
  openrouterKey?: string,
): Promise<AnalysisResult> {
  const startedAt = Date.now();
  const pages = await crawlWebsite(url, firecrawlKey);
  const initial = analyzeCrawl(pages, url, Date.now() - startedAt);
  const needsActiveJourney = initial.journey.businessModels.includes("Ecommerce")
    && initial.journey.primary.status === "incomplete"
    && Date.now() - startedAt < 30_000;
  const observedJourney = needsActiveJourney
    ? await verifyCustomerJourney(url, firecrawlKey)
    : null;
  const processingMs = Date.now() - startedAt;
  return buildReportFromPages(
    pages,
    url,
    processingMs,
    processingMs < 42_000 ? openrouterKey : undefined,
    observedJourney,
  );
}
