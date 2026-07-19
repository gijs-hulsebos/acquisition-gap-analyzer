import { NextResponse } from "next/server";
import { FirecrawlError } from "./firecrawl";

export function analysisErrorResponse(error: unknown) {
  console.error("Analysis pipeline error", error);
  if (error instanceof FirecrawlError) {
    const unavailable = [429, 502, 503, 504].includes(error.status);
    return NextResponse.json(
      {
        code: unavailable ? "FIRECRAWL_UNAVAILABLE" : "FIRECRAWL_FAILED",
        error: unavailable
          ? "Firecrawl is temporarily unavailable. Please try again."
          : `The website crawl failed during ${error.operation}.`,
      },
      { status: unavailable ? 503 : 502 },
    );
  }

  const message = error instanceof Error ? error.message : "The website could not be analyzed.";
  const timeout = /timeout|timed out|scan time/i.test(message);
  return NextResponse.json(
    { code: timeout ? "FIRECRAWL_TIMEOUT" : "ANALYSIS_FAILED", error: message },
    { status: timeout ? 504 : 500 },
  );
}
