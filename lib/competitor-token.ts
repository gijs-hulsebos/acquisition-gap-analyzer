import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebsiteCrawlJob } from "./firecrawl";

export type CompetitorJobToken = {
  version: 1;
  issuedAt: number;
  sourceUrl: string;
  competitor: { name: string; url: string };
  job: WebsiteCrawlJob;
};

const TOKEN_TTL_MS = 15 * 60 * 1_000;

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signCompetitorJob(state: CompetitorJobToken, secret: string) {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyCompetitorJob(token: string, secret: string): CompetitorJobToken {
  const [payload, suppliedSignature] = token.split(".");
  if (!payload || !suppliedSignature) throw new Error("Invalid competitor scan token.");
  const expectedSignature = signature(payload, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("Invalid competitor scan token.");
  const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as CompetitorJobToken;
  if (state.version !== 1 || !state.job?.id || !state.competitor?.url || Date.now() - state.issuedAt > TOKEN_TTL_MS) {
    throw new Error("The competitor scan has expired. Start a new scan.");
  }
  return state;
}
