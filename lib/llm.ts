import type { AnalysisResult, Gap, ImprovementReport } from "./types";

type Rewrite = Pick<Gap, "id" | "summary"> & { nextAction: string };

function compactResult(result: AnalysisResult) {
  return {
    companyName: result.companyName,
    url: result.url,
    score: result.score,
    estimatedClicks: result.overview.estimatedClicks,
    findings: result.gaps.map((gap) => ({
      id: gap.id,
      title: gap.title,
      score: gap.score,
      summary: gap.summary,
      evidence: gap.evidence.map((item) => item.statement),
      nextAction: gap.nextAction,
    })),
  };
}

function fallbackComparison(company: AnalysisResult, competitor: AnalysisResult): string[] {
  return company.gaps.flatMap((gap) => {
    const other = competitor.gaps.find((item) => item.id === gap.id);
    if (!other || gap.score === null || other.score === null) return [];
    const difference = other.score - gap.score;
    if (gap.id === "customer-journey-path" && company.overview.estimatedClicks !== null && competitor.overview.estimatedClicks !== null) {
      const clicks = company.overview.estimatedClicks - competitor.overview.estimatedClicks;
      if (clicks === 0) return [`Both websites require an estimated ${company.overview.estimatedClicks} clicks to conversion.`];
      return [`${competitor.companyName}'s estimated conversion route is ${Math.abs(clicks)} click${Math.abs(clicks) === 1 ? "" : "s"} ${clicks > 0 ? "shorter" : "longer"} than ${company.companyName}'s.`];
    }
    if (Math.abs(difference) < 5) return [`Both websites perform similarly for ${gap.title}.`];
    return [`${competitor.companyName} scores ${Math.abs(difference)} points ${difference > 0 ? "higher" : "lower"} than ${company.companyName} for ${gap.title}.`];
  }).slice(0, 3);
}

export async function enhanceFindings(
  result: AnalysisResult,
  apiKey: string | undefined,
  comparisonBase?: AnalysisResult,
): Promise<AnalysisResult> {
  const fallbackReport: ImprovementReport = comparisonBase
    ? { ...result.improvementReport, competitorComparison: fallbackComparison(comparisonBase, result) }
    : result.improvementReport;
  const fallbackResult = { ...result, improvementReport: fallbackReport };
  if (!apiKey || result.readiness.status === "insufficient-data") return fallbackResult;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
        "X-OpenRouter-Title": "Acquisition Gap Analyzer",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini",
        temperature: 0.2,
        max_completion_tokens: 1100,
        messages: [
          {
            role: "system",
            content:
              "Write concise acquisition-report copy only from the supplied deterministic JSON. Never invent facts, scores, evidence or journey steps. Keep finding summaries under 18 words and actions under 14 words. For the improvement report, return 1-3 specific strengths and 1-3 specific improvements grounded in the evidence. If BASE_COMPANY is present, write 1-3 competitor comparisons from the base company's perspective; otherwise return an empty competitorComparison array.",
          },
          {
            role: "user",
            content: JSON.stringify({
              analyzedWebsite: compactResult(result),
              baseCompany: comparisonBase ? compactResult(comparisonBase) : null,
            }),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "acquisition_gap_rewrites",
            strict: true,
            schema: {
              type: "object",
              properties: {
                gaps: {
                  type: "array",
                  minItems: 3,
                  maxItems: 3,
                  items: {
                    type: "object",
                    properties: {
                      id: {
                        type: "string",
                        enum: [
                          "offer-clarity",
                          "purchase-confidence",
                          "customer-journey-path",
                        ],
                      },
                      summary: { type: "string" },
                      nextAction: { type: "string" },
                    },
                    required: ["id", "summary", "nextAction"],
                    additionalProperties: false,
                  },
                },
                improvementReport: {
                  type: "object",
                  properties: {
                    whatIsDoneWell: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
                    whatCouldBeBetter: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
                    competitorComparison: { type: "array", minItems: 0, maxItems: 3, items: { type: "string" } },
                  },
                  required: ["whatIsDoneWell", "whatCouldBeBetter", "competitorComparison"],
                  additionalProperties: false,
                },
              },
              required: ["gaps", "improvementReport"],
              additionalProperties: false,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) return fallbackResult;
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) return fallbackResult;

    const parsed = JSON.parse(content) as { gaps?: Rewrite[]; improvementReport?: ImprovementReport };
    if (!parsed.gaps || parsed.gaps.length !== 3 || !parsed.improvementReport) return fallbackResult;
    const report = parsed.improvementReport;
    if (!report.whatIsDoneWell?.length || !report.whatCouldBeBetter?.length || !Array.isArray(report.competitorComparison)) return fallbackResult;

    const rewrites = new Map(parsed.gaps.map((gap) => [gap.id, gap]));
    if (rewrites.size !== 3) return fallbackResult;

    return {
      ...result,
      llmEnhanced: true,
      improvementReport: report,
      gaps: result.gaps.map((gap) => {
        if (gap.id === "offer-clarity" || (gap.id === "customer-journey-path" && result.journey.primary.status === "incomplete")) {
          return gap;
        }
        const rewrite = rewrites.get(gap.id);
        return rewrite
          ? { ...gap, summary: rewrite.summary, nextAction: rewrite.nextAction }
          : gap;
      }),
    };
  } catch {
    return fallbackResult;
  }
}
