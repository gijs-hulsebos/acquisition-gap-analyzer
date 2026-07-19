import { NextResponse } from "next/server";
import { signCompetitorJob } from "@/lib/competitor-token";
import { DEMO_COMPETITOR_RESULT } from "@/lib/fixture";
import { startWebsiteCrawl } from "@/lib/firecrawl";
import type { CompetitorScanStartResponse } from "@/lib/types";
import { normalizeAndValidateUrl } from "@/lib/url";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function POST(request: Request) {
  let body: { mode?: unknown; selectedUrl?: unknown; sourceUrl?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Send a valid JSON request body." }, { status: 400 }); }
  if (body.mode === "fixture") {
    const response: CompetitorScanStartResponse = { status: "complete", result: DEMO_COMPETITOR_RESULT };
    return NextResponse.json(response, { headers: { "Cache-Control": "private, max-age=60" } });
  }

  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  if (!firecrawlKey) return NextResponse.json({ error: "Competitor scanning requires FIRECRAWL_API_KEY." }, { status: 503 });

  try {
    const selectedUrl = normalizeAndValidateUrl(body.selectedUrl);
    const sourceUrl = normalizeAndValidateUrl(body.sourceUrl);
    if (new URL(sourceUrl).hostname.replace(/^www\./, "") === new URL(selectedUrl).hostname.replace(/^www\./, "")) throw new Error("The competitor must use a different domain.");
    const candidate = { name: new URL(selectedUrl).hostname.replace(/^www\./, ""), url: new URL(selectedUrl).origin };

    const job = await startWebsiteCrawl(candidate.url, firecrawlKey);
    const token = signCompetitorJob({
      version: 1,
      issuedAt: Date.now(),
      sourceUrl,
      competitor: { name: candidate.name, url: candidate.url },
      job,
    }, process.env.COMPETITOR_SCAN_SECRET || firecrawlKey);
    const response: CompetitorScanStartResponse = { status: "processing", token, competitor: { name: candidate.name, url: candidate.url } };
    return NextResponse.json(response, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The competitor scan could not be started." }, { status: 502 });
  }
}
