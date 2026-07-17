import type { AnalysisResult } from "./types";

function fallbackMessage(status: number) {
  if (status === 504) return "The scan took too long. Please try again in a moment.";
  if (status >= 500) return "The analysis service returned an unexpected response. Please try again.";
  return "The website could not be analyzed.";
}

export async function readAnalysisResponse(response: Response): Promise<AnalysisResult> {
  const text = await response.text();
  let payload: unknown = null;

  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (!response.ok) throw new Error(fallbackMessage(response.status));
      throw new Error("The analysis service returned an unreadable response. Please try again.");
    }
  }

  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : fallbackMessage(response.status);
    throw new Error(message);
  }

  if (!payload || typeof payload !== "object" || !("gaps" in payload)) {
    throw new Error("The analysis service returned an incomplete report. Please try again.");
  }

  return payload as AnalysisResult;
}
