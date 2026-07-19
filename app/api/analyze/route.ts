import { NextResponse } from "next/server";
import { DEMO_RESULT } from "@/lib/fixture";
import { crawlWebsite } from "@/lib/firecrawl";
import { buildReportFromPages } from "@/lib/report";
import { normalizeAndValidateUrl } from "@/lib/url";

export const runtime = "nodejs";
export const maxDuration = 60;

function within<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

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
    const pages = await within(
      crawlWebsite(url, firecrawlKey),
      32_000,
      "The first-party crawl took too long to return evidence. Please try again.",
    );
    const report = await buildReportFromPages(
      pages,
      url,
      Date.now() - startedAt,
      Date.now() - startedAt < 42_000 ? process.env.OPENROUTER_API_KEY : undefined,
    );
    const result = { ...report, stats: { ...report.stats, processingMs: Date.now() - startedAt } };
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The website could not be analyzed.";
    return NextResponse.json(
      { error: message },
      { status: /too long/i.test(message) ? 504 : 502 },
    );
  }
}
