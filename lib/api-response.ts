import type { AnalysisResult } from "./types";

function fallbackMessage(status: number) {
  if (status === 504) return "The scan took too long. Please try again in a moment.";
  if (status >= 500) return "The analysis service returned an unexpected response. Please try again.";
  return "The website could not be analyzed.";
}

export async function readJsonResponse<T>(response: Response, fallback: string): Promise<T> {
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text.trim() ? JSON.parse(text) : null;
  } catch {
    throw new Error(response.ok ? "The server returned an unreadable response." : fallbackMessage(response.status));
  }

  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : fallbackMessage(response.status);
    throw new Error(message);
  }
  if (!payload) throw new Error(fallback);
  return payload as T;
}

export async function readAnalysisResponse(response: Response): Promise<AnalysisResult> {
  const payload = await readJsonResponse<unknown>(response, "The analysis service returned an empty response.");

  if (!payload || typeof payload !== "object" || !("gaps" in payload)) {
    throw new Error("The analysis service returned an incomplete report. Please try again.");
  }

  return payload as AnalysisResult;
}
