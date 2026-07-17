import type { AnalysisResult, Gap } from "./types";

type Rewrite = Pick<Gap, "id" | "title" | "summary"> & { nextAction: string };

export async function enhanceFindings(
  result: AnalysisResult,
  apiKey: string | undefined,
): Promise<AnalysisResult> {
  if (!apiKey) return result;

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
        max_completion_tokens: 650,
        messages: [
          {
            role: "system",
            content:
              "Rewrite only the supplied facts in plain English. Add nothing. Keep titles under 7 words, summaries under 14 words and actions under 12 words.",
          },
          {
            role: "user",
            content: JSON.stringify(
              result.gaps.map((gap) => ({
                id: gap.id,
                title: gap.title,
                summary: gap.summary,
                evidence: gap.evidence.map((item) => item.statement),
                nextAction: gap.nextAction,
              })),
            ),
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
                          "cta",
                          "service-page",
                          "conversion-path",
                          "form-friction",
                          "message-consistency",
                          "trust-signals",
                        ],
                      },
                      title: { type: "string" },
                      summary: { type: "string" },
                      nextAction: { type: "string" },
                    },
                    required: ["id", "title", "summary", "nextAction"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["gaps"],
              additionalProperties: false,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) return result;
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) return result;

    const parsed = JSON.parse(content) as { gaps?: Rewrite[] };
    if (!parsed.gaps || parsed.gaps.length !== 3) return result;

    const rewrites = new Map(parsed.gaps.map((gap) => [gap.id, gap]));
    if (rewrites.size !== 3) return result;

    return {
      ...result,
      llmEnhanced: true,
      gaps: result.gaps.map((gap) => {
        const rewrite = rewrites.get(gap.id);
        return rewrite
          ? { ...gap, title: rewrite.title, summary: rewrite.summary, nextAction: rewrite.nextAction }
          : gap;
      }),
    };
  } catch {
    return result;
  }
}
