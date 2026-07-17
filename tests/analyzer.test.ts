import { describe, expect, it } from "vitest";
import { analyzeCrawl, detectTrustSignals } from "../lib/analyzer";
import { analyzeCompetitorPage, applyCompetitorAnalysis } from "../lib/competitors";
import { buildDeterministicEntityProfile, competitorCandidateScore } from "../lib/entity";
import { classifyCommercialModel, journeyRolesForModel } from "../lib/journey-model";
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
  it("always returns the three required deterministic findings and overview", () => {
    const result = analyzeCrawl(scoredSite({ trustOnContact: true }), "https://voorbeeld.nl/", 1250);
    const categories = result.readiness.categories;
    const expected = Math.round(
      categories.reduce((sum, category) => sum + category.score! * category.weight, 0) /
        categories.reduce((sum, category) => sum + category.weight, 0),
    );

    expect(categories.map((category) => category.id)).toEqual(["offer-clarity", "cta-clarity", "customer-journey-path"]);
    expect(result.gaps.map((gap) => gap.id)).toEqual(["offer-clarity", "cta-clarity", "customer-journey-path"]);
    expect(categories.reduce((sum, category) => sum + category.weight, 0)).toBe(100);
    expect(result.score).toBe(expected);
    expect(result.overview.score).toBe(expected);
    expect(result.readiness.status).toBe("scored");
    expect(result.confidence).toBe("Medium");
  });

  it("returns a cautious but complete report from one representative landing page", () => {
    const homepage = scoredSite()[0];
    const result = analyzeCrawl([homepage], "https://voorbeeld.nl/", 120);
    expect(result.score).toEqual(expect.any(Number));
    expect(result.gaps).toHaveLength(3);
    expect(result.gaps[2].title).toBe("Customer Journey Path");
    expect(result.gaps[2].summary).toMatch(/could not be confirmed/i);
    expect(result.overview.estimatedClicks).toBeNull();
  });
});

describe("trust-signal analysis", () => {
  it("detects configured visible trust evidence deterministically", () => {
    const signals = detectTrustSignals(
      "Klanten geven ons 4.9 sterren. KIWA gecertificeerd. 10 jaar garantie. Bel 030 123 45 67.",
    );
    expect(signals).toEqual(expect.arrayContaining(["Reviews or ratings", "Certifications", "Guarantees", "Contact details"]));
  });

  it("keeps trust detection separate from the three-report contract", () => {
    const result = analyzeCrawl(scoredSite({ trustOnContact: false }), "https://voorbeeld.nl/", 900);
    expect(result.gaps).toHaveLength(3);
    expect(result.stats.trustSignals).toEqual(expect.any(Number));
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
    expect(competitor.metrics.map((metric) => metric.label)).toEqual(["Offer Clarity", "CTA clarity", "Customer Journey Path"]);
    expect(competitor.findings.map((finding) => finding.id)).toEqual(["offer-clarity", "cta-clarity", "customer-journey-path"]);
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
    expect(compared.competitors.competitors[0].findings).toHaveLength(3);
    expect(compared.competitors.competitors[0].findings.every((finding) => finding.evidence.every((evidence) => evidence.source === "competitor"))).toBe(true);
  });
});

describe("entity-first competitor discovery", () => {
  it("resolves a retailer from company-wide evidence instead of a single product phrase", () => {
    const pages = [
      page({
        url: "https://voorbeeldwinkel.nl/",
        title: "Voorbeeldwinkel | Natuurlijke woon- en keukenaccessoires",
        html: '<html><body><h1>Alles voor huis, tuin en keuken</h1><p>Ontdek onze winkels en webshop met woonaccessoires, keukenaccessoires, tafelen en cadeaus.</p><a href="/collectie">Bekijk collectie</a></body></html>',
      }),
      page({
        url: "https://voorbeeldwinkel.nl/collectie",
        title: "Collectie woonaccessoires en cadeaus | Voorbeeldwinkel",
        html: '<html><body><h1>Onze collectie</h1><p>Producten voor koken, tafelen, wonen en cadeaus. Bestel via onze webshop of bezoek een winkel.</p></body></html>',
      }),
    ];
    const result = analyzeCrawl(pages, "https://voorbeeldwinkel.nl/", 300);
    const entity = buildDeterministicEntityProfile(result, pages);

    expect(entity.industry).toBe("Home and lifestyle retail");
    expect(entity.businessModel).toBe("retail-ecommerce");
  });

  it("rejects search candidates from a different industry", () => {
    const pages = scoredSite({ trustOnContact: true });
    const result = analyzeCrawl(pages, "https://voorbeeld.nl/", 300);
    const entity = buildDeterministicEntityProfile(result, pages);
    const relevant = competitorCandidateScore(entity, {
      title: "Warmtepomp specialist voor woningen",
      description: "Advies, installatie en onderhoud van warmtepompen in Utrecht.",
      url: "https://warmteconcurrent.nl/diensten/warmtepompen",
    });
    const unrelated = competitorCandidateScore(entity, {
      title: "Brandveiligheid voor kantoren",
      description: "Inspectie van blusmiddelen en brandmeldinstallaties.",
      url: "https://brandveiligheid.example/diensten",
    });

    expect(relevant).toBeGreaterThanOrEqual(5);
    expect(unrelated).toBe(-100);
  });
});

describe("representative customer journeys", () => {
  it("classifies the landing page before choosing a journey template", () => {
    const ecommerceHome = page({
      url: "https://winkel.nl/",
      title: "Voorbeeldwinkel",
      html: '<html><body><h1>Wonen en keuken</h1><a href="/collecties/keuken">Bekijk collectie</a><a href="/cart">Winkelmand</a></body></html>',
    });
    const serviceHome = page({
      url: "https://installateur.nl/",
      title: "Installateur",
      html: '<html><body><h1>Installatie en onderhoud</h1><a href="/diensten">Onze diensten</a><a href="/offerte">Vraag offerte aan</a></body></html>',
    });

    expect(classifyCommercialModel([ecommerceHome])).toBe("ecommerce");
    expect(journeyRolesForModel("ecommerce")).toEqual(["homepage", "category", "product", "cart", "checkout"]);
    expect(classifyCommercialModel([serviceHome])).toBe("service");
    expect(journeyRolesForModel("service")).toEqual(["homepage", "service", "conversion"]);
  });

  it("builds an ecommerce route through category, product, cart and checkout", () => {
    const pages = [
      page({ url: "https://winkel.nl/", title: "Voorbeeldwinkel", links: ["https://winkel.nl/collecties/keuken"], html: '<html><body><h1>Wonen en keuken</h1><p>Shop onze collectie woonaccessoires en keukenproducten.</p><a href="/collecties/keuken">Bekijk collectie</a></body></html>' }),
      page({ url: "https://winkel.nl/collecties/keuken", title: "Keuken", links: ["https://winkel.nl/products/pan"], html: '<html><body><h1>Keuken</h1><p>Bekijk producten voor koken en tafelen.</p><a href="/products/pan">Bekijk pan</a></body></html>' }),
      page({ url: "https://winkel.nl/products/pan", title: "Pan", html: '<html><body><h1>Pan</h1><p>Een pan voor dagelijks koken.</p><button>In winkelmand</button></body></html>' }),
      page({ url: "https://winkel.nl/cart", title: "Winkelmand", html: '<html><body><h1>Winkelmand</h1><p>Controleer uw bestelling.</p><button>Naar de kassa</button></body></html>' }),
      page({ url: "https://winkel.nl/checkout", title: "Afrekenen", html: '<html><body><h1>Afrekenen</h1><form><input name="email" required><input name="address" required><button>Bestelling plaatsen</button></form></body></html>' }),
    ];
    const result = analyzeCrawl(pages, "https://winkel.nl/", 500);

    expect(result.journey.businessModels).toContain("Ecommerce");
    expect(result.journey.primaryConversionType).toBe("Checkout");
    expect(result.journey.primary.clicksToInterface).toBe(4);
    expect(result.journey.primary.stages.map((stage) => stage.pageType)).toEqual(["Homepage", "Category", "Product", "Cart", "Checkout"]);
    expect(result.journey.primary.additionalObservableActions).toBe(3);
    expect(result.gaps.map((gap) => gap.title)).toEqual(["Offer Clarity", "CTA Clarity", "Customer Journey Path"]);
  });
});
