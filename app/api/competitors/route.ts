import { NextResponse } from "next/server";
import { scanPublicCompetitors } from "@/lib/competitor-scan";
import { DEMO_RESULT } from "@/lib/fixture";
import type { BusinessModel, CompetitorScanResult } from "@/lib/types";
import { normalizeAndValidateUrl } from "@/lib/url";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUSINESS_MODELS = new Set<BusinessModel>(["Ecommerce", "Lead generation", "Appointment or booking", "Software or subscription", "Professional services", "Local service business", "Marketplace", "Informational or non-commercial"]);

function demoResult(): CompetitorScanResult {
  const make = (name: string, url: string, adjustment: number) => ({
    name, url, pagesAnalyzed: 3,
    score: Math.max(0, (DEMO_RESULT.score || 0) + adjustment),
    estimatedClicks: adjustment > 0 ? 4 : 5,
    findings: DEMO_RESULT.gaps.map((gap) => ({ ...gap, score: gap.score === null ? null : Math.max(0, Math.min(100, gap.score + adjustment)), evidence: gap.evidence.map((item) => ({ ...item, url })) })),
  });
  return { sourceUrl: DEMO_RESULT.url, searchedAt: new Date().toISOString(), competitors: [make("Studio Living", "https://studio-living.example", 3), make("Home & Form", "https://home-form.example", -6)], note: "Two direct public competitors were analyzed." };
}

export async function POST(request: Request) {
  let body: { mode?: unknown; url?: unknown; companyName?: unknown; primaryOffer?: unknown; businessModel?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Send a valid JSON request body." }, { status: 400 }); }
  if (body.mode === "fixture") return NextResponse.json(demoResult(), { headers: { "Cache-Control": "private, max-age=60" } });

  let url: string;
  try { url = normalizeAndValidateUrl(body.url); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid website URL." }, { status: 400 }); }
  const companyName = typeof body.companyName === "string" ? body.companyName.trim().slice(0, 100) : "";
  const primaryOffer = typeof body.primaryOffer === "string" ? body.primaryOffer.trim().slice(0, 240) : "";
  const businessModel = typeof body.businessModel === "string" && BUSINESS_MODELS.has(body.businessModel as BusinessModel) ? body.businessModel as BusinessModel : null;
  if (!companyName || !primaryOffer || !businessModel) return NextResponse.json({ error: "The completed report does not contain enough company information." }, { status: 400 });

  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  if (!firecrawlKey) return NextResponse.json({ error: "Competitor scanning requires FIRECRAWL_API_KEY." }, { status: 503 });
  try {
    const result = await scanPublicCompetitors({ url, companyName, primaryOffer, businessModel }, firecrawlKey, process.env.OPENROUTER_API_KEY);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The competitor scan failed." }, { status: 502 });
  }
}
