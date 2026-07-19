import { NextResponse } from "next/server";
import { DEMO_COMPETITOR_RESULT } from "@/lib/fixture";
import { analyzeWebsite } from "@/lib/report";
import { analysisErrorResponse } from "@/lib/route-error";
import type { CompetitorScanResult, PublicCompetitor } from "@/lib/types";
import { normalizeAndValidateUrl, siteHostname } from "@/lib/url";

export const runtime = "nodejs";
export const maxDuration = 60;

function asCompetitor(report: Awaited<ReturnType<typeof analyzeWebsite>>): PublicCompetitor {
  return {
    name: report.companyName,
    url: report.url,
    pagesAnalyzed: report.pages.length,
    score: report.score,
    estimatedClicks: report.overview.estimatedClicks,
    findings: report.gaps,
  };
}

export async function POST(request: Request) {
  let body: { mode?: unknown; selectedUrl?: unknown; sourceUrl?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a valid JSON request body." }, { status: 400 });
  }

  if (body.mode === "fixture") {
    return NextResponse.json(DEMO_COMPETITOR_RESULT, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  }

  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  if (!firecrawlKey) {
    return NextResponse.json({ error: "Competitor comparison requires FIRECRAWL_API_KEY." }, { status: 503 });
  }

  let selectedUrl: string;
  let sourceUrl: string;
  try {
    selectedUrl = normalizeAndValidateUrl(body.selectedUrl);
    sourceUrl = normalizeAndValidateUrl(body.sourceUrl);
    if (siteHostname(selectedUrl) === siteHostname(sourceUrl)) {
      return NextResponse.json({ error: "The competitor must use a different domain." }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Enter a valid competitor URL." }, { status: 400 });
  }

  try {
    const report = await analyzeWebsite(selectedUrl, firecrawlKey, process.env.OPENROUTER_API_KEY);
    const result: CompetitorScanResult = {
      sourceUrl,
      searchedAt: new Date().toISOString(),
      competitor: asCompetitor(report),
      note: "The comparison website was analyzed with the same pipeline as the original website.",
    };
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return analysisErrorResponse(error);
  }
}
