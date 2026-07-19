import { NextResponse } from "next/server";
import { verifyCompetitorJob } from "@/lib/competitor-token";
import { getWebsiteCrawlProgress, scrapeWebsitePage } from "@/lib/firecrawl";
import { buildAnalysisResult } from "@/lib/report";
import type { CompetitorScanStatusResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 25;

export async function GET(request: Request) {
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  if (!firecrawlKey) {
    return NextResponse.json({ error: "Competitor scanning requires FIRECRAWL_API_KEY." }, { status: 503 });
  }

  try {
    const token = new URL(request.url).searchParams.get("token") || "";
    const state = verifyCompetitorJob(token, process.env.COMPETITOR_SCAN_SECRET || firecrawlKey);
    const startedAt = Date.now();
    const progress = await getWebsiteCrawlProgress(state.job, firecrawlKey, 7_000);

    if (progress.status === "processing") {
      const response: CompetitorScanStatusResponse = { status: "processing", competitor: state.competitor };
      return NextResponse.json(response, { status: 202, headers: { "Cache-Control": "no-store" } });
    }
    let pages = progress.pages;
    if (progress.status === "failed" || !pages.length) {
      const fallback = await scrapeWebsitePage(state.competitor.url, firecrawlKey, 10_000).catch(() => null);
      if (fallback) pages = [fallback];
    }
    if (!pages.length) {
      const response: CompetitorScanStatusResponse = {
        status: "failed",
        error: progress.error || "The competitor website returned no readable pages.",
      };
      return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
    }

    // Finalize with the same deterministic analysis and optional LLM wording
    // used by /api/analyze. Only the dashboard presentation differs.
    const result = await buildAnalysisResult(pages, state.competitor.url, startedAt);
    const response: CompetitorScanStatusResponse = { status: "complete", result };
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The competitor scan status could not be read." },
      { status: 400 },
    );
  }
}
