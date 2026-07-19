import { NextResponse } from "next/server";
import { discoverPublicCompetitor } from "@/lib/competitor-scan";
import { signCompetitorJob } from "@/lib/competitor-token";
import { DEMO_RESULT } from "@/lib/fixture";
import { startWebsiteCrawl } from "@/lib/firecrawl";
import type { BusinessModel, CompetitorScanResult, CompetitorScanStartResponse } from "@/lib/types";
import { normalizeAndValidateUrl } from "@/lib/url";

export const runtime = "nodejs";
export const maxDuration = 45;

const BUSINESS_MODELS = new Set<BusinessModel>(["Ecommerce", "Lead generation", "Appointment or booking", "Software or subscription", "Professional services", "Local service business", "Marketplace", "Informational or non-commercial"]);

function demoResult(): CompetitorScanResult {
  const url = "https://studio-living.example";
  return {
    sourceUrl: DEMO_RESULT.url,
    searchedAt: new Date().toISOString(),
    competitor: {
      name: "Studio Living",
      url,
      pagesAnalyzed: 3,
      score: Math.min(100, (DEMO_RESULT.score || 0) + 3),
      estimatedClicks: 4,
      findings: DEMO_RESULT.gaps.map((gap) => ({
        ...gap,
        score: gap.score === null ? null : Math.min(100, gap.score + 3),
        evidence: gap.evidence.map((item) => ({ ...item, url })),
      })),
    },
    note: "One direct public competitor was analyzed.",
  };
}

export async function POST(request: Request) {
  let body: { mode?: unknown; url?: unknown; companyName?: unknown; primaryOffer?: unknown; businessModel?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Send a valid JSON request body." }, { status: 400 }); }
  if (body.mode === "fixture") {
    const response: CompetitorScanStartResponse = { status: "complete", result: demoResult() };
    return NextResponse.json(response, { headers: { "Cache-Control": "private, max-age=60" } });
  }

  let url: string;
  try { url = normalizeAndValidateUrl(body.url); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid website URL." }, { status: 400 }); }
  const companyName = typeof body.companyName === "string" ? body.companyName.trim().slice(0, 100) : "";
  const primaryOffer = typeof body.primaryOffer === "string" ? body.primaryOffer.trim().slice(0, 240) : "";
  const businessModel = typeof body.businessModel === "string" && BUSINESS_MODELS.has(body.businessModel as BusinessModel) ? body.businessModel as BusinessModel : null;
  if (!companyName || !primaryOffer || !businessModel) return NextResponse.json({ error: "The completed report does not contain enough company information." }, { status: 400 });

  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  if (!firecrawlKey) return NextResponse.json({ error: "Competitor scanning requires FIRECRAWL_API_KEY." }, { status: 503 });

  try {
    const candidate = await discoverPublicCompetitor({ url, companyName, primaryOffer, businessModel }, firecrawlKey, process.env.OPENROUTER_API_KEY);
    if (!candidate) {
      const response: CompetitorScanStartResponse = {
        status: "complete",
        result: { sourceUrl: url, searchedAt: new Date().toISOString(), competitor: null, note: "No sufficiently direct public competitor was found." },
      };
      return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
    }

    const job = await startWebsiteCrawl(candidate.url, firecrawlKey, 3, {
      maxDiscoveryDepth: 2,
      scrapeTimeoutMs: 20_000,
      startTimeoutMs: 7_000,
    });
    const token = signCompetitorJob({
      version: 1,
      issuedAt: Date.now(),
      sourceUrl: url,
      competitor: { name: candidate.title, url: candidate.url },
      job,
    }, process.env.COMPETITOR_SCAN_SECRET || firecrawlKey);
    const response: CompetitorScanStartResponse = { status: "processing", token, competitor: { name: candidate.title, url: candidate.url } };
    return NextResponse.json(response, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The competitor scan could not be started." }, { status: 502 });
  }
}
