import { NextResponse } from "next/server";
import { DEMO_RESULT } from "@/lib/fixture";
import { analyzeWebsite } from "@/lib/report";
import { analysisErrorResponse } from "@/lib/route-error";
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

  try {
    const result = await analyzeWebsite(url, firecrawlKey, process.env.OPENROUTER_API_KEY);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return analysisErrorResponse(error);
  }
}
