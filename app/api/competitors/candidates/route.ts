import { NextResponse } from "next/server";
import { discoverPublicCompetitorCandidates } from "@/lib/competitor-scan";
import { signCompetitorCandidates } from "@/lib/competitor-token";
import type { BusinessModel, CompetitorCandidate, CompetitorCandidatesResult } from "@/lib/types";
import { normalizeAndValidateUrl } from "@/lib/url";

export const runtime = "nodejs";
export const maxDuration = 45;

const BUSINESS_MODELS = new Set<BusinessModel>(["Ecommerce", "Lead generation", "Appointment or booking", "Software or subscription", "Professional services", "Local service business", "Marketplace", "Informational or non-commercial"]);

const DEMO_CANDIDATES: CompetitorCandidate[] = [
  { name: "Studio Living", url: "https://studio-living.example", reason: "A Dutch home and lifestyle retailer serving a similar customer market.", evidenceUrls: ["https://example.com/market-overview"] },
  { name: "Home & Form", url: "https://home-form.example", reason: "A comparable homeware store with overlapping products and online purchasing.", evidenceUrls: ["https://example.com/retail-comparison"] },
];

export async function POST(request: Request) {
  let body: { mode?: unknown; url?: unknown; companyName?: unknown; primaryOffer?: unknown; businessModel?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Send a valid JSON request body." }, { status: 400 }); }
  if (body.mode === "fixture") {
    const result: CompetitorCandidatesResult = { candidates: DEMO_CANDIDATES, token: "fixture-token" };
    return NextResponse.json(result, { headers: { "Cache-Control": "private, max-age=60" } });
  }

  let url: string;
  try { url = normalizeAndValidateUrl(body.url); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid website URL." }, { status: 400 }); }
  const companyName = typeof body.companyName === "string" ? body.companyName.trim().slice(0, 100) : "";
  const primaryOffer = typeof body.primaryOffer === "string" ? body.primaryOffer.trim().slice(0, 240) : "";
  const businessModel = typeof body.businessModel === "string" && BUSINESS_MODELS.has(body.businessModel as BusinessModel) ? body.businessModel as BusinessModel : null;
  if (!companyName || !primaryOffer || !businessModel) return NextResponse.json({ error: "The completed report does not contain enough company information." }, { status: 400 });

  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  if (!firecrawlKey) return NextResponse.json({ error: "Competitor discovery requires FIRECRAWL_API_KEY." }, { status: 503 });
  try {
    const candidates = await discoverPublicCompetitorCandidates({ url, companyName, primaryOffer, businessModel }, firecrawlKey, process.env.OPENROUTER_API_KEY);
    const token = signCompetitorCandidates({ version: 1, issuedAt: Date.now(), sourceUrl: url, candidates }, process.env.COMPETITOR_SCAN_SECRET || firecrawlKey);
    const result: CompetitorCandidatesResult = { candidates, token };
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Competitor candidates could not be found." }, { status: 502 });
  }
}
