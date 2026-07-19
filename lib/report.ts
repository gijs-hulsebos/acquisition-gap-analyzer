import { analyzeCrawl } from "./analyzer";
import { enhanceFindings } from "./llm";
import type { AnalysisResult, CrawlPage } from "./types";

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export async function buildAnalysisResult(
  pages: CrawlPage[],
  url: string,
  startedAt: number,
  enhancementTimeoutMs = 8_000,
  comparisonBase?: AnalysisResult,
): Promise<AnalysisResult> {
  const deterministic = analyzeCrawl(pages, url, Date.now() - startedAt);
  let result = deterministic;

  if (process.env.OPENROUTER_API_KEY && enhancementTimeoutMs > 0) {
    try {
      result = await withTimeout(
        enhanceFindings(deterministic, process.env.OPENROUTER_API_KEY, comparisonBase),
        enhancementTimeoutMs,
        "Report copy enhancement timed out.",
      );
    } catch {
      result = await enhanceFindings(deterministic, undefined, comparisonBase);
    }
  } else if (comparisonBase) {
    result = await enhanceFindings(deterministic, undefined, comparisonBase);
  }

  return { ...result, stats: { ...result.stats, processingMs: Date.now() - startedAt } };
}
