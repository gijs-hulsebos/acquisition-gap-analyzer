import { NextResponse } from "next/server";
import { analyzeCrawl } from "@/lib/analyzer";
import { applyCompetitorAnalysis } from "@/lib/competitors";
import { DEMO_RESULT } from "@/lib/fixture";
import { crawlWebsite, discoverCompetitorPages } from "@/lib/firecrawl";
import { buildCompetitorSearchQuery, buildDeterministicEntityProfile, resolveCompanyEntity } from "@/lib/entity";
import { enhanceFindings } from "@/lib/llm";
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
      25_000,
      "The first-party crawl took too long to return evidence. Please try again.",
    );
    const deterministic = analyzeCrawl(pages, url, Date.now() - startedAt);
    const fallbackEntity = buildDeterministicEntityProfile(deterministic, pages);
    let entity = fallbackEntity;
    if (process.env.OPENROUTER_API_KEY && Date.now() - startedAt < 30_000) {
      try {
        entity = await within(
          resolveCompanyEntity(deterministic, pages, process.env.OPENROUTER_API_KEY),
          5_500,
          "Company profile enrichment timed out.",
        );
      } catch {
        entity = fallbackEntity;
      }
    }
    const entityResolved = {
      ...deterministic,
      competitors: {
        ...deterministic.competitors,
        query: buildCompetitorSearchQuery(entity),
        geography: entity.geography,
        targetCustomer: entity.targetCustomer,
        entity,
        note: `Resolved ${entity.companyName} as ${entity.industry} before competitor discovery.`,
      },
    };
    let compared = entityResolved;
    const competitorBudget = Math.min(19_000, 50_000 - (Date.now() - startedAt));
    if (competitorBudget >= 4_000) {
      try {
        const discovery = await within(
          discoverCompetitorPages(entity, url, firecrawlKey),
          competitorBudget,
          "Competitor discovery timed out.",
        );
        const withComparisons = applyCompetitorAnalysis(entityResolved, discovery.accepted);
        compared = {
          ...withComparisons,
          competitors: { ...withComparisons.competitors, rejected: discovery.rejected },
        };
      } catch {
        compared = {
          ...entityResolved,
          competitors: {
            ...entityResolved.competitors,
            status: "not-found",
            note: `The entity was resolved as ${entity.industry}, but competitor evidence was unavailable within this scan. The main company report is unaffected.`,
          },
        };
      }
    } else {
      compared = {
        ...entityResolved,
        competitors: {
          ...entityResolved.competitors,
          status: "skipped",
          note: `The company report used the available scan time, so competitor discovery was skipped. The main company report is unaffected.`,
        },
      };
    }
    let result = compared;
    if (process.env.OPENROUTER_API_KEY && Date.now() - startedAt < 44_000) {
      try {
        result = await within(
          enhanceFindings(compared, process.env.OPENROUTER_API_KEY),
          Math.min(7_000, 52_000 - (Date.now() - startedAt)),
          "Report copy enhancement timed out.",
        );
      } catch {
        result = compared;
      }
    }
    result = { ...result, stats: { ...result.stats, processingMs: Date.now() - startedAt } };
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The website could not be analyzed.";
    return NextResponse.json(
      { error: message },
      { status: /too long/i.test(message) ? 504 : 502 },
    );
  }
}
