import { NextResponse } from "next/server";
import { competitorFromPages } from "@/lib/competitor-scan";
import { verifyCompetitorJob } from "@/lib/competitor-token";
import { getWebsiteCrawlProgress } from "@/lib/firecrawl";
import type { CompetitorScanStatusResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET(request: Request) {
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  if (!firecrawlKey) return NextResponse.json({ error: "Competitor scanning requires FIRECRAWL_API_KEY." }, { status: 503 });

  try {
    const token = new URL(request.url).searchParams.get("token") || "";
    const state = verifyCompetitorJob(token, process.env.COMPETITOR_SCAN_SECRET || firecrawlKey);
    const progress = await getWebsiteCrawlProgress(state.job, firecrawlKey, 7_000);
    if (progress.status === "processing") {
      const response: CompetitorScanStatusResponse = { status: "processing", competitor: state.competitor };
      return NextResponse.json(response, { status: 202, headers: { "Cache-Control": "no-store" } });
    }
    if (progress.status === "failed" || !progress.pages.length) {
      const response: CompetitorScanStatusResponse = { status: "failed", error: progress.error || "The competitor website returned no readable pages." };
      return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
    }

    const competitor = competitorFromPages(state.competitor.url, progress.pages);
    const response: CompetitorScanStatusResponse = {
      status: "complete",
      result: {
        sourceUrl: state.sourceUrl,
        searchedAt: new Date().toISOString(),
        competitor: { ...competitor, name: competitor.name || state.competitor.name },
        note: "One direct public competitor was analyzed.",
      },
    };
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The competitor scan status could not be read." }, { status: 400 });
  }
}
