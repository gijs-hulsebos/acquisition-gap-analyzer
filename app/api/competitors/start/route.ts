import { NextResponse } from "next/server";
import { signCompetitorJob } from "@/lib/competitor-token";
import { startWebsiteCrawl } from "@/lib/firecrawl";
import type { CompetitorScanStartResponse } from "@/lib/types";
import { normalizeAndValidateUrl } from "@/lib/url";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function POST(request: Request) {
  let body: { url?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a valid JSON request body." }, { status: 400 });
  }

  let url: string;
  try {
    url = normalizeAndValidateUrl(body.url);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Enter a valid competitor website URL." },
      { status: 400 },
    );
  }

  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  if (!firecrawlKey) {
    return NextResponse.json({ error: "Competitor scanning requires FIRECRAWL_API_KEY." }, { status: 503 });
  }

  try {
    // Start the exact same bounded eight-page crawl used by the main analyzer,
    // then let the browser poll it without holding one serverless request open.
    const job = await startWebsiteCrawl(url, firecrawlKey, 8);
    const token = signCompetitorJob({
      version: 1,
      issuedAt: Date.now(),
      sourceUrl: url,
      competitor: { name: new URL(url).hostname.replace(/^www\./, ""), url },
      job,
    }, process.env.COMPETITOR_SCAN_SECRET || firecrawlKey);
    const response: CompetitorScanStartResponse = {
      status: "processing",
      token,
      competitor: { name: new URL(url).hostname.replace(/^www\./, ""), url },
    };
    return NextResponse.json(response, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The competitor scan could not be started." },
      { status: 502 },
    );
  }
}
