import { detectTrustSignals } from "./analyzer";
import type {
  AnalysisResult,
  CrawlPage,
  Evidence,
  Gap,
  PublicSearchCompetitor,
  ResolvedCompanyEntity,
} from "./types";

const CLEAR_CTA = /\b(offerte|prijsopgave|advies|afspraak|consult|plan|boek|bel|demo|aanvragen|start|kennismak|quote|estimate|call|book|schedule|get started|talk to)\b/i;
const GENERIC_CTA = /\b(contact|lees meer|meer informatie|ontdek|bekijk|learn more|read more|discover)\b/i;
const CONTACT_DESTINATION = /^(mailto:|tel:)|\/(contact|afspraak|offerte|boeken|book|booking|quote|aanvraag|consult)/i;
const NON_SERVICE_PATH = /\/(contact|over-ons|about|team|blog|nieuws|news|cases?|projecten?|privacy|voorwaarden|terms|vacatures?|jobs?)(\/|$)/i;

type CompetitorPageFacts = {
  clearCtas: Array<{ text: string; href: string }>;
  genericCtas: Array<{ text: string; href: string }>;
  forms: number;
};

function cleanText(value: string) {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function inspectPage(page: CrawlPage): CompetitorPageFacts {
  const clearCtas: Array<{ text: string; href: string }> = [];
  const genericCtas: Array<{ text: string; href: string }> = [];
  const pattern = /<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(page.html))) {
    const text = cleanText(match[3]);
    const href = match[2].match(/href\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    if (!text || text.length > 90) continue;
    if (CLEAR_CTA.test(text)) clearCtas.push({ text, href });
    else if (GENERIC_CTA.test(text)) genericCtas.push({ text, href });
  }

  return { clearCtas, genericCtas, forms: (page.html.match(/<form\b/gi) || []).length };
}

function relevantTokens(value: string) {
  return value.toLowerCase().replace(/[^a-zà-ÿ0-9\s-]/g, " ").split(/[\s-]+/).filter((token) => token.length >= 5).slice(0, 6);
}

function competitorName(page: CrawlPage) {
  const fromTitle = page.title.split(/\s+[|—–-]\s+/)[0]?.trim();
  const genericTitle = /^(home(page)?|the best|best |top\s*\d|reviews?|bedrijven in|winkels in)/i;
  const looksLikeAddress = /\b\d{4}\s?[A-Z]{2}\b|,\s*(the )?nethe/i.test(fromTitle || "");
  if (fromTitle && fromTitle.length <= 60 && !genericTitle.test(fromTitle) && !looksLikeAddress) return fromTitle;
  return new URL(page.url).hostname.replace(/^www\./, "").split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function severityForScore(score: number): Gap["severity"] {
  const impact = 100 - score;
  if (impact >= 85) return "Critical";
  if (impact >= 65) return "High";
  if (impact >= 40) return "Medium";
  return "Low";
}

function offerClarity(page: CrawlPage) {
  const h1 = cleanText(page.html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
  const generic = /^(home(page)?|welkom|welcome)$/i;
  let score = 10;
  if (h1.length >= 12 && h1.length <= 120 && !generic.test(h1)) score += 40;
  if (page.title.trim().length >= 8 && !generic.test(page.title.trim())) score += 25;
  if (page.description.trim().length >= 45) score += 25;
  return { score: Math.min(100, score), h1 };
}

export function analyzeCompetitorPage(page: CrawlPage, identity: string | ResolvedCompanyEntity): PublicSearchCompetitor {
  const facts = inspectPage(page);
  const pageText = cleanText(page.html) || cleanText(page.markdown);
  const trustSignals = detectTrustSignals(pageText, page.html);
  const ctaClarity = facts.clearCtas.length >= 2 ? 92 : facts.clearCtas.length === 1 ? 72 : facts.genericCtas.length ? 35 : 12;
  const directContactLink = [...facts.clearCtas, ...facts.genericCtas].find((item) => CONTACT_DESTINATION.test(item.href));
  const conversionPathSteps = facts.forms > 0 ? 0 : directContactLink ? 1 : null;
  const path = new URL(page.url).pathname;
  const serviceContext = typeof identity === "string" ? identity : `${identity.industry} ${identity.offerings.join(" ")}`;
  const serviceTerms = relevantTokens(serviceContext);
  const serviceHaystack = `${path} ${page.title} ${page.description}`.toLowerCase();
  const dedicatedServicePage = path !== "/" && !NON_SERVICE_PATH.test(path) && serviceTerms.some((term) => serviceHaystack.includes(term));
  const ctaText = facts.clearCtas[0]?.text || facts.genericCtas[0]?.text;
  const offer = offerClarity(page);
  const pathScore = conversionPathSteps === 0 ? 95 : conversionPathSteps === 1 ? 80 : 20;

  const serviceEvidence: Evidence = {
    statement: dedicatedServicePage
      ? "The selected public-search result is a service-specific commercial page."
      : "The selected public-search result does not clearly use a service-specific URL.",
    pageLabel: "Selected competitor page",
    url: page.url,
    source: "competitor",
  };
  const ctaEvidence: Evidence = {
    statement: ctaText ? `The selected page uses the visible CTA “${ctaText}”.` : "No clear CTA was detected on the selected page.",
    pageLabel: "Selected competitor page",
    url: page.url,
    source: "competitor",
  };
  const pathEvidence: Evidence = {
    statement: conversionPathSteps === 0
      ? "A form is visible on the selected page."
      : conversionPathSteps === 1
        ? "The selected page links directly to a visible contact action."
        : "A direct form or contact destination was not visible on the selected page.",
    pageLabel: "Selected competitor page",
    url: page.url,
    source: "competitor",
  };
  const trustEvidence: Evidence = {
    statement: trustSignals.length ? `Visible trust signal types: ${trustSignals.join(", ")}.` : "No configured trust-signal type was detected on the selected page.",
    pageLabel: "Selected competitor page",
    url: page.url,
    source: "competitor",
  };
  const offerEvidence: Evidence = {
    statement: `Offer clarity scored ${offer.score}/100 from the selected page title, heading and description. ${offer.h1 ? `Detected heading: “${offer.h1}”.` : "No readable H1 heading was detected."}`,
    pageLabel: "Selected competitor page",
    url: page.url,
    source: "competitor",
  };
  const findings: Gap[] = [
    {
      id: "offer-clarity",
      rank: 1,
      title: "Offer Clarity",
      summary: offer.score >= 80 ? "The selected page makes its offer immediately clear." : "The selected page may require more interpretation to understand its offer.",
      severity: severityForScore(offer.score),
      score: offer.score,
      confidence: "Medium",
      evidence: [offerEvidence],
      nextAction: offer.score >= 80 ? "Keep the offer consistent." : "Clarify the main heading.",
    },
    {
      id: "cta-clarity",
      rank: 2,
      title: "CTA Clarity",
      summary: ctaText ? `The selected page uses “${ctaText}” as a visible action.` : "No specific conversion CTA was detected in the selected HTML.",
      severity: severityForScore(ctaClarity),
      score: ctaClarity,
      confidence: "Medium",
      evidence: [ctaEvidence],
      nextAction: ctaClarity >= 80 ? "Keep the primary CTA consistent." : "Use a specific conversion CTA.",
    },
    {
      id: "customer-journey-path",
      rank: 3,
      title: "Customer Journey Path",
      summary: conversionPathSteps === 0 ? "A conversion form is visible on the selected page." : conversionPathSteps === 1 ? "The selected page exposes a one-click conversion route." : "A direct conversion route was not confirmed on the selected page.",
      severity: severityForScore(pathScore),
      score: pathScore,
      confidence: "Medium",
      evidence: [pathEvidence],
      nextAction: conversionPathSteps === null ? "Expose a direct conversion route." : "Keep the route prominent.",
    },
  ];

  return {
    name: competitorName(page),
    url: page.url,
    pageTitle: page.title,
    label: "Likely public search competitor",
    dedicatedServicePage,
    ctaClarity,
    conversionPathSteps,
    trustSignals,
    findings,
    metrics: [
      { label: "Offer Clarity", value: `${offer.score}/100`, evidence: offerEvidence },
      { label: "CTA clarity", value: `${ctaClarity}/100`, evidence: ctaEvidence },
      { label: "Customer Journey Path", value: conversionPathSteps === 0 ? "0 clicks" : conversionPathSteps === 1 ? "1 click" : "Unconfirmed", evidence: pathEvidence },
    ],
  };
}

function competitorEvidence(competitor: PublicSearchCompetitor, statement: string): Evidence {
  return {
    statement: `Likely public search competitor ${competitor.name}: ${statement}`,
    pageLabel: "Selected competitor commercial page",
    url: competitor.url,
    source: "competitor",
  };
}

/** Adds comparison evidence only to findings that already exist. */
export function applyCompetitorAnalysis(result: AnalysisResult, pages: CrawlPage[]): AnalysisResult {
  const competitors = pages.slice(0, 2).map((page) => analyzeCompetitorPage(page, result.competitors.entity));

  const gaps = result.gaps.map((gap) => {
    const stronger = competitors
      .map((competitor) => ({ competitor, finding: competitor.findings.find((item) => item.id === gap.id) }))
      .find((item) => item.finding && item.finding.score >= gap.score + 10);
    if (!stronger?.finding) return gap;
    const comparison = competitorEvidence(stronger.competitor, `${gap.title} scored ${stronger.finding.score}/100 on its selected commercial page, compared with ${gap.score}/100 for the analyzed journey.`);
    return { ...gap, evidence: [...gap.evidence, comparison] };
  });

  return {
    ...result,
    gaps,
    competitors: {
      ...result.competitors,
      status: competitors.length ? "available" : "not-found",
      note: competitors.length
        ? `Resolved ${result.competitors.entity.companyName} as ${result.competitors.entity.industry}, then selected matching Dutch public-search businesses with the same market profile. Only one commercial page per domain was checked.`
        : `No public-search business sufficiently matched the resolved ${result.competitors.entity.industry} profile.`,
      competitors,
    },
  };
}
