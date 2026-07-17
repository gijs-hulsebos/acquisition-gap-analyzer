import { describe, expect, it } from "vitest";
import { analyzeCrawl, detectTrustSignals } from "../lib/analyzer";
import { analyzeCompetitorPage, applyCompetitorAnalysis } from "../lib/competitors";
import type { CrawlPage } from "../lib/types";

function page(overrides: Partial<CrawlPage> & Pick<CrawlPage, "url" | "title" | "html">): CrawlPage {
  return {
    description: "Warmtepompinstallatie voor woningeigenaren in Utrecht met persoonlijk advies en professionele plaatsing.",
    markdown: "",
    links: [],
    statusCode: 200,
    ...overrides,
  };
}

function scoredSite(options: { trustOnContact?: boolean; longForm?: boolean } = {}) {
  const contactTrust = options.trustOnContact
    ? "<section><h2>Beoordeeld met 4.8 sterren</h2><p>KIWA gecertificeerd. Bel 030 123 45 67.</p></section>"
    : "<section><h2>Vertel ons over uw woning</h2><p>Wij nemen na uw aanvraag contact met u op om de situatie rustig door te spreken.</p></section>";
  const extraFields = options.longForm
    ? '<input name="street" required><input name="postcode" required><input name="city" required><input name="budget"><input name="date"><textarea name="details" required></textarea>'
    : "";

  return [
    page({
      url: "https://voorbeeld.nl/",
      title: "Warmtepompinstallatie Utrecht | Voorbeeld",
      links: ["https://voorbeeld.nl/diensten/warmtepomp", "https://voorbeeld.nl/contact"],
      html: `<html><head><title>Warmtepompinstallatie Utrecht</title></head><body><h1>Warmtepompinstallatie voor woningen</h1><p>Wij installeren duurzame warmtepompen voor woningeigenaren in Utrecht. Persoonlijk advies, heldere installatie en lokale service voor uw woning.</p><a href="/contact">Vraag een offerte aan</a><a href="/diensten/warmtepomp">Bekijk warmtepompen</a></body></html>`,
    }),
    page({
      url: "https://voorbeeld.nl/diensten/warmtepomp",
      title: "Warmtepompinstallatie voor woningen | Voorbeeld",
      links: ["https://voorbeeld.nl/contact"],
      html: `<html><body><h1>Warmtepompinstallatie voor woningen</h1><p>Alles over advies, installatie, onderhoud en besparing met een warmtepomp voor uw woning in Utrecht.</p><a href="/contact">Plan een adviesgesprek</a></body></html>`,
    }),
    page({
      url: "https://voorbeeld.nl/contact",
      title: "Offerte aanvragen | Voorbeeld",
      html: `<html><body><h1>Vraag een warmtepompofferte aan</h1>${contactTrust}<form><input name="name" required><input name="email" required><input name="phone">${extraFields}<button>Verstuur aanvraag</button></form></body></html>`,
    }),
  ];
}

describe("weighted readiness", () => {
  it("calculates readiness directly from assessed category weights", () => {
    const result = analyzeCrawl(scoredSite({ trustOnContact: true }), "https://voorbeeld.nl/", 1250);
    const assessed = result.readiness.categories.filter((category) => category.score !== null);
    const expected = Math.round(
      assessed.reduce((sum, category) => sum + category.score! * category.weight, 0) /
        assessed.reduce((sum, category) => sum + category.weight, 0),
    );

    expect(result.readiness.categories).toHaveLength(6);
    expect(result.readiness.categories.reduce((sum, category) => sum + category.weight, 0)).toBe(100);
    expect(result.score).toBe(expected);
    expect(result.readiness.status).toBe("scored");
    expect(result.confidence).toBe("Medium");
  });

  it("keeps form friction unscored when no form is available", () => {
    const pages = scoredSite().map((item) => ({ ...item, html: item.html.replace(/<form>[\s\S]*?<\/form>/, "") }));
    const result = analyzeCrawl(pages, "https://voorbeeld.nl/", 500);
    expect(result.readiness.categories.find((category) => category.id === "form-friction")?.score).toBeNull();
    expect(result.readiness.assessedWeight).toBe(85);
  });

  it("returns insufficient data instead of forcing a one-page score", () => {
    const homepage = scoredSite()[0];
    const result = analyzeCrawl([homepage], "https://voorbeeld.nl/", 120);
    expect(result.score).toBeNull();
    expect(result.scoreLabel).toBe("Insufficient data");
    expect(result.readiness.status).toBe("insufficient-data");
  });
});

describe("trust-signal analysis", () => {
  it("detects configured visible trust evidence deterministically", () => {
    const signals = detectTrustSignals(
      "Klanten geven ons 4.9 sterren. KIWA gecertificeerd. 10 jaar garantie. Bel 030 123 45 67.",
    );
    expect(signals).toEqual(expect.arrayContaining(["Reviews or ratings", "Certifications", "Guarantees", "Contact details"]));
  });

  it("creates a cautious evidence-backed gap when the conversion page has no proof", () => {
    const result = analyzeCrawl(scoredSite({ trustOnContact: false }), "https://voorbeeld.nl/", 900);
    const gap = result.gaps.find((item) => item.id === "trust-signals");
    expect(gap).toBeDefined();
    expect(gap?.evidence[0].url).toBe("https://voorbeeld.nl/contact");
    expect(gap?.evidence[0].statement).toMatch(/No visible|No configured/i);
    expect(gap?.summary).toMatch(/little or no|no visible/i);
  });

  it("scores a longer form lower than a short form", () => {
    const shortResult = analyzeCrawl(scoredSite({ trustOnContact: true }), "https://voorbeeld.nl/", 500);
    const longResult = analyzeCrawl(scoredSite({ trustOnContact: true, longForm: true }), "https://voorbeeld.nl/", 500);
    const shortScore = shortResult.readiness.categories.find((item) => item.id === "form-friction")?.score;
    const longScore = longResult.readiness.categories.find((item) => item.id === "form-friction")?.score;
    expect(longScore).toBeLessThan(shortScore!);
  });
});

describe("lightweight competitor analysis", () => {
  it("inspects one selected commercial page with the requested comparison metrics", () => {
    const competitor = analyzeCompetitorPage(
      page({
        url: "https://concurrent.nl/diensten/warmtepompinstallatie",
        title: "Warmtepompinstallatie Utrecht | Concurrent",
        html: '<html><body><h1>Warmtepompinstallatie</h1><p>4.9 sterren. KIWA gecertificeerd. 10 jaar garantie.</p><a href="/contact">Vraag een offerte aan</a><form><input name="email"></form></body></html>',
      }),
      "Warmtepompinstallatie voor woningen",
    );
    expect(competitor.label).toBe("Likely public search competitor");
    expect(competitor.dedicatedServicePage).toBe(true);
    expect(competitor.metrics.map((metric) => metric.label)).toEqual([
      "Dedicated service page",
      "CTA clarity",
      "Direct conversion path",
      "Trust signals",
    ]);
  });

  it("adds competitor evidence only to findings that already exist", () => {
    const result = analyzeCrawl(scoredSite({ trustOnContact: false }), "https://voorbeeld.nl/", 500);
    const originalIds = result.gaps.map((gap) => gap.id);
    const competitorPages = [
      page({
        url: "https://concurrent.nl/diensten/warmtepompinstallatie",
        title: "Warmtepompinstallatie | Concurrent",
        html: '<html><body><h1>Warmtepompinstallatie</h1><p>4.9 sterren en KIWA gecertificeerd.</p><a href="/contact">Vraag een offerte aan</a><form><input name="email"></form></body></html>',
      }),
    ];
    const compared = applyCompetitorAnalysis(result, competitorPages);

    expect(compared.gaps.map((gap) => gap.id)).toEqual(originalIds);
    expect(compared.competitors.competitors).toHaveLength(1);
    expect(compared.gaps.flatMap((gap) => gap.evidence).some((evidence) => evidence.source === "competitor")).toBe(true);
    expect(compared.gaps.flatMap((gap) => gap.evidence).filter((evidence) => evidence.source === "competitor").every((evidence) => /Likely public search competitor/.test(evidence.statement))).toBe(true);
  });
});
