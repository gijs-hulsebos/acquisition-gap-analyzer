import { NextResponse } from "next/server";
import { DEMO_RESULT } from "@/lib/fixture";
import { crawlWebsite } from "@/lib/firecrawl";
import { buildAnalysisResult, withTimeout } from "@/lib/report";
import { normalizeAndValidateUrl } from "@/lib/url";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: { url?: unknown; mode?: unknown };
  try {
    body = (await request.json()) as { url?: unknown; mode?: unknown };
  } catch {
    return NextResponse.json({ error: "Send a valid JSON request body." }, { status: 400 });
  }

  if (body.mode === "fixture") {
    return NextResponse.json(DEMO_RESULT, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  }

  let url: string;
  try {
    url = normalizeAndValidateUrl(body.url);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Enter a valid website URL." },
      { status: 400 },
    );
  }

  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  if (!firecrawlKey) {
    return NextResponse.json(
      {
        error:
          "Live analysis is not configured yet. Add FIRECRAWL_API_KEY or use the saved demo.",
      },
      { status: 503 },
    );
  }

  const startedAt = Date.now();
  try {
    const pages = await withTimeout(
      crawlWebsite(url, firecrawlKey),
      32_000,
      "The first-party crawl took too long to return evidence. Please try again.",
    );
    const elapsed = Date.now() - startedAt;
    const result = await buildAnalysisResult(
      pages,
      url,
      startedAt,
      elapsed < 42_000 ? Math.min(8_000, 52_000 - elapsed) : 0,
    );
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The website could not be analyzed.";
    return NextResponse.json(
      { error: message },
      { status: /too long/i.test(message) ? 504 : 502 },
    );
  }
}
