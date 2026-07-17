import { detectTrustSignals } from "./analyzer";
import type {
  AnalysisResult,
  CrawlPage,
  Evidence,
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

  return {
    name: competitorName(page),
    url: page.url,
    pageTitle: page.title,
    label: "Likely public search competitor",
    dedicatedServicePage,
    ctaClarity,
    conversionPathSteps,
    trustSignals,
    metrics: [
      { label: "Dedicated service page", value: dedicatedServicePage ? "Visible" : "Not clear", evidence: serviceEvidence },
      { label: "CTA clarity", value: `${ctaClarity}/100`, evidence: ctaEvidence },
      { label: "Direct conversion path", value: conversionPathSteps === 0 ? "Form on page" : conversionPathSteps === 1 ? "1 step" : "Not visible", evidence: pathEvidence },
      { label: "Trust signals", value: `${trustSignals.length} type${trustSignals.length === 1 ? "" : "s"}`, evidence: trustEvidence },
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
  const categories = new Map(result.readiness.categories.map((item) => [item.id, item]));

  const gaps = result.gaps.map((gap) => {
    let comparison: Evidence | null = null;

    if (gap.id === "service-page" && result.stats.servicePages === 0) {
      const competitor = competitors.find((item) => item.dedicatedServicePage);
      if (competitor) comparison = competitorEvidence(competitor, "the selected result is a dedicated service page, while none was found in the analyzed crawl.");
    }

    if (gap.id === "cta") {
      const siteScore = categories.get("cta-clarity")?.score;
      const competitor = competitors.find((item) => siteScore !== null && siteScore !== undefined && item.ctaClarity >= siteScore + 15);
      if (competitor) comparison = competitorEvidence(competitor, `its selected page has a clearer deterministic CTA score (${competitor.ctaClarity}/100).`);
    }

    if (gap.id === "conversion-path" && result.stats.conversionPathSteps !== null) {
      const competitor = competitors.find((item) => item.conversionPathSteps !== null && item.conversionPathSteps < result.stats.conversionPathSteps!);
      if (competitor) comparison = competitorEvidence(competitor, `its selected page exposes a ${competitor.conversionPathSteps === 0 ? "form immediately" : "one-step contact action"}.`);
    }

    if (gap.id === "trust-signals") {
      const siteScore = categories.get("trust-signals")?.score || 0;
      const competitor = competitors.find((item) => item.trustSignals.length > 0 && item.trustSignals.length * 25 > siteScore);
      if (competitor) comparison = competitorEvidence(competitor, `its selected page shows ${competitor.trustSignals.join(", ")}.`);
    }

    return comparison ? { ...gap, evidence: [...gap.evidence, comparison] } : gap;
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
