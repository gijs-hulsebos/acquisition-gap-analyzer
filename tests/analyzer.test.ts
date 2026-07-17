import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeCrawl } from "../lib/analyzer";
import { readAnalysisResponse } from "../lib/api-response";
import { analyzeCompetitorPage, analyzeCompetitorSite, applyCompetitorAnalysis } from "../lib/competitors";
import { buildDeterministicEntityProfile, competitorCandidateScore } from "../lib/entity";
import { crawlWebsite, discoverCompetitorPages, selectRepresentativeResults } from "../lib/firecrawl";
import { classifyCommercialModel, journeyRolesForModel } from "../lib/journey-model";
import type { CrawlPage, ResolvedCompanyEntity } from "../lib/types";

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

afterEach(() => vi.restoreAllMocks());

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

  it("returns insufficient data from fewer than three useful pages", () => {
    const homepage = scoredSite()[0];
    const result = analyzeCrawl([homepage], "https://voorbeeld.nl/", 120);
    expect(result.score).toBeNull();
    expect(result.overview.status).toBe("Insufficient data");
    expect(result.readiness.status).toBe("insufficient-data");
    expect(result.summary).toMatch(/only 1 useful page/i);
    expect(result.gaps).toHaveLength(3);
    expect(result.gaps.every((gap) => gap.score === null)).toBe(true);
    expect(result.gaps.every((gap) => gap.evidence.length > 0 && gap.nextAction.length > 0)).toBe(true);
    expect(result.gaps[2].title).toBe("Customer Journey Path");
    expect(result.overview.estimatedClicks).toBeNull();
  });
});

describe("lightweight competitor analysis", () => {
  it("uses the same three deterministic checks across representative competitor pages", () => {
    const pages = scoredSite({ trustOnContact: true }).map((item) => ({ ...item, url: item.url.replace("voorbeeld.nl", "concurrent.nl"), links: item.links.map((link) => link.replace("voorbeeld.nl", "concurrent.nl")) }));
    const competitor = analyzeCompetitorSite({ seedUrl: pages[0].url, pages }, "Warmtepompinstallatie voor woningen");
    const direct = analyzeCrawl(pages, "https://concurrent.nl/", 0);
    expect(competitor.label).toBe("Likely public search competitor");
    expect(competitor.dataStatus).toBe("scored");
    expect(competitor.pagesAnalyzed).toBe(3);
    expect(competitor.findings.map((finding) => finding.id)).toEqual(["offer-clarity", "cta-clarity", "customer-journey-path"]);
    expect(competitor.findings.map((finding) => finding.score)).toEqual(direct.gaps.map((finding) => finding.score));
  });

  it("marks a one-page competitor crawl as insufficient instead of claiming a full score", () => {
    const competitor = analyzeCompetitorPage(scoredSite()[0], "Warmtepompinstallatie voor woningen");
    expect(competitor.dataStatus).toBe("insufficient-data");
    expect(competitor.findings.every((finding) => finding.score === null)).toBe(true);
  });

  it("shows an accepted competitor in the report without changing the fixed findings", () => {
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
    expect(compared.competitors.competitors[0].url).toBe("https://concurrent.nl");
    expect(compared.competitors.competitors[0].findings).toHaveLength(3);
    expect(compared.competitors.competitors[0].findings.every((finding) => finding.evidence.every((evidence) => evidence.source === "competitor"))).toBe(true);
  });

  it("keeps the main report when competitor discovery returns no accepted businesses", () => {
    const result = analyzeCrawl(scoredSite({ trustOnContact: true }), "https://voorbeeld.nl/", 500);
    const compared = applyCompetitorAnalysis(result, []);
    expect(compared.score).toBe(result.score);
    expect(compared.gaps).toEqual(result.gaps);
    expect(compared.competitors.status).toBe("not-found");
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
    expect(competitorCandidateScore(entity, {
      title: "Woonwinkel met woonaccessoires, servies en cadeaus",
      description: "Bekijk het assortiment van deze Nederlandse webshop voor huis, keuken en tuin.",
      url: "https://vergelijkbare-winkel.nl/collectie/wonen",
    })).toBeGreaterThanOrEqual(5);
    expect(competitorCandidateScore(entity, {
      title: "Zakelijke software voor accountants",
      description: "Cloudsoftware voor financiële administratie.",
      url: "https://software.example/product",
    })).toBe(-100);
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

  it("rejects same-company, directory and unrelated results before crawling external domains", async () => {
    const entity: ResolvedCompanyEntity = {
      companyName: "Dille & Kamille",
      domain: "dille-kamille.nl",
      industry: "Home and lifestyle retail",
      businessModel: "retail-ecommerce",
      offerings: ["woonaccessoires", "keukenaccessoires en servies", "cadeaus"],
      geography: "Nederland",
      targetCustomer: "particulieren",
      confidence: "High",
      method: "deterministic",
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const requestUrl = String(input);
      if (requestUrl.endsWith("/search")) {
        return new Response(JSON.stringify({ success: true, data: { web: [
          { title: "Dille & Kamille België", description: "De Belgische webshop.", url: "https://dille-kamille.be/" },
          { title: "Dille & Kamille reviews", description: "Reviews en ervaringen.", url: "https://trustpilot.com/review/dille-kamille.nl" },
          { title: "Boekhoudsoftware", description: "Software voor accountants.", url: "https://softwarewinkel.nl/" },
          { title: "Andere Woonwinkel", description: "Nederlandse webshop met woonaccessoires, servies en cadeaus.", url: "https://andere-woonwinkel.nl/" },
          { title: "Onbereikbare Woonwinkel", description: "Nederlandse webshop met woonaccessoires, servies en cadeaus.", url: "https://onbereikbare-woonwinkel.nl/" },
        ] } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (requestUrl.endsWith("/crawl") && init?.method === "POST") {
        const body = String(init?.body || "");
        if (body.includes("onbereikbare-woonwinkel.nl")) throw new Error("Crawl unavailable");
        return new Response(JSON.stringify({ success: true, id: "andere-woonwinkel-job" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (requestUrl.endsWith("/crawl/andere-woonwinkel-job")) {
        return new Response(JSON.stringify({ status: "completed", data: [{
          markdown: "Woonaccessoires, servies en cadeaus. Bekijk ons assortiment. Product € 12,95. Product € 18,95. Zakelijk bestellen kan via de klantenservice.",
          html: '<h1>Woonaccessoires, servies en cadeaus</h1><a href="/collectie">Bekijk assortiment</a><div class="product-card">€ 12,95</div><div class="product-card">€ 18,95</div>',
          links: ["https://andere-woonwinkel.nl/collectie"],
          metadata: { sourceURL: "https://andere-woonwinkel.nl/", title: "Andere Woonwinkel", description: "Nederlandse webshop voor wonen en cadeaus.", statusCode: 200 },
        }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (requestUrl.endsWith("/scrape")) {
        if (String(init?.body || "").includes("onbereikbare-woonwinkel.nl")) throw new Error("Crawl unavailable");
        return new Response(JSON.stringify({ success: true, data: {
          markdown: "Woonaccessoires, servies en cadeaus. Bekijk ons assortiment. Product € 12,95. Product € 18,95. Zakelijk bestellen kan via de klantenservice.",
          html: '<h1>Woonaccessoires, servies en cadeaus</h1><a href="/collectie">Bekijk assortiment</a><div class="product-card">€ 12,95</div><div class="product-card">€ 18,95</div>',
          links: ["https://andere-woonwinkel.nl/collectie"],
          metadata: { sourceURL: "https://andere-woonwinkel.nl/", title: "Andere Woonwinkel", description: "Nederlandse webshop voor wonen en cadeaus.", statusCode: 200 },
        } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (requestUrl.endsWith("/map")) {
        return new Response(JSON.stringify({ success: false, error: "No map" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const discovery = await discoverCompetitorPages(entity, "https://dille-kamille.nl/", "test-key");
    expect(discovery.accepted).toHaveLength(1);
    expect(discovery.accepted[0].seedUrl).toBe("https://andere-woonwinkel.nl/");
    expect(discovery.rejected.map((item) => item.reason)).toEqual(expect.arrayContaining([
      "Same company or a regional version of the submitted company.",
      "Directory, blog, review site or other non-commercial result.",
      "Insufficient industry, offer, geography or target-customer match.",
      "The accepted competitor domain could not be read within the crawl budget.",
    ]));
    expect(discovery.rejected.some((item) => item.url === "https://onbereikbare-woonwinkel.nl/" && item.crawled)).toBe(true);
    const crawlBodies = fetchMock.mock.calls.filter(([input, init]) => String(input).endsWith("/crawl") && init?.method === "POST").map(([, init]) => String(init?.body));
    expect(crawlBodies).toHaveLength(2);
    expect(crawlBodies.some((body) => body.includes("andere-woonwinkel.nl"))).toBe(true);
    expect(crawlBodies.some((body) => body.includes("onbereikbare-woonwinkel.nl"))).toBe(true);
    expect(crawlBodies.join(" ")).not.toContain("dille-kamille.be");
    expect(crawlBodies.join(" ")).not.toContain("trustpilot.com");
    expect(crawlBodies.join(" ")).not.toContain("softwarewinkel.nl");
    const auditedOrigins = new Set([
      ...discovery.accepted.map((site) => new URL(site.seedUrl).origin),
      ...discovery.rejected.map((item) => new URL(item.url).origin),
    ]);
    expect(auditedOrigins).toEqual(new Set([
      "https://dille-kamille.be",
      "https://trustpilot.com",
      "https://softwarewinkel.nl",
      "https://andere-woonwinkel.nl",
      "https://onbereikbare-woonwinkel.nl",
    ]));
  });
});

describe("representative customer journeys", () => {
  it("selects a diverse bounded page set without keeping many similar products", () => {
    const pages = [
      page({ url: "https://winkel.nl/", title: "Winkel", html: "<h1>Winkel</h1>" }),
      page({ url: "https://winkel.nl/collecties/keuken", title: "Keuken", html: "<h1>Keuken</h1>" }),
      page({ url: "https://winkel.nl/products/pan", title: "Pan", html: "<h1>Pan</h1><button>In winkelmand</button>" }),
      page({ url: "https://winkel.nl/products/bord", title: "Bord", html: "<h1>Bord</h1><button>In winkelmand</button>" }),
      page({ url: "https://winkel.nl/cart", title: "Winkelmand", html: "<h1>Winkelmand</h1>" }),
      page({ url: "https://winkel.nl/checkout", title: "Afrekenen", html: "<h1>Afrekenen</h1>" }),
      page({ url: "https://winkel.nl/retour", title: "Retourneren", html: "<h1>Retourneren</h1>" }),
      page({ url: "https://winkel.nl/blog/zomer", title: "Zomerblog", html: "<h1>Zomerblog</h1>" }),
      page({ url: "https://external.example/products/pan", title: "Extern product", html: "<h1>Extern product</h1><button>In winkelmand</button>" }),
    ];
    const selected = selectRepresentativeResults(pages, "https://winkel.nl/", 8);
    expect(selected[0].url).toBe("https://winkel.nl/");
    expect(selected.length).toBeGreaterThanOrEqual(3);
    expect(selected.length).toBeLessThanOrEqual(8);
    expect(selected.filter((item) => /\/products\//.test(item.url)).length).toBeLessThanOrEqual(2);
    expect(selected.every((item) => new URL(item.url).origin === "https://winkel.nl")).toBe(true);
    expect(selected.map((item) => item.url)).toEqual(expect.arrayContaining([
      "https://winkel.nl/collecties/keuken",
    ]));
  });
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

  it("uses rendered Markdown categories, search and product cards from a real ecommerce landing page", () => {
    const pages = [
      page({
        url: "https://woonwinkel.nl/",
        title: "Woonwinkel",
        description: "Producten voor koken, tafelen, wonen en cadeaus.",
        links: ["https://woonwinkel.nl/collectie/zomer", "https://woonwinkel.nl/nl/wonen/buitenkaars-123"],
        html: '<html><body><h1>Woonwinkel</h1><input type="search" placeholder="Waar ben je naar op zoek?"></body></html>',
        markdown: "# Zomer bij Woonwinkel\n\n[Ontdek ons assortiment](/collectie/zomer)\n\n## Categorieën\n[Zomer](/collectie/zomer) [Picknick](/collectie/picknick)\n\n## Producten\n[Buitenkaars](/nl/wonen/buitenkaars-123) 16,95\n[Dienblad](/nl/wonen/dienblad-456) 16,95",
      }),
      page({
        url: "https://woonwinkel.nl/collectie/zomer",
        title: "Zomercollectie",
        links: ["https://woonwinkel.nl/nl/wonen/buitenkaars-123"],
        html: "<html><body><h1>Zomercollectie</h1></body></html>",
        markdown: "# Zomercollectie\nProducten voor buiten, picknick en tuin.\n[Buitenkaars](/nl/wonen/buitenkaars-123) 16,95",
      }),
      page({
        url: "https://woonwinkel.nl/nl/wonen/buitenkaars-123",
        title: "Buitenkaars",
        html: "<html><body><h1>Buitenkaars</h1></body></html>",
        markdown: "# Buitenkaars\nEen betonnen buitenkaars voor lange zomeravonden in de tuin. Prijs 16,95.\n[In winkelmand](/cart)",
      }),
    ];

    const result = analyzeCrawl(pages, "https://woonwinkel.nl/", 300);
    expect(result.journey.businessModels).toContain("Ecommerce");
    expect(result.gaps.map((gap) => gap.id)).toEqual(["offer-clarity", "cta-clarity", "customer-journey-path"]);
    expect(result.gaps[0].summary).toMatch(/browse and buy products/i);
    expect(result.gaps[0].evidence[0].statement).toMatch(/product\/price signals/i);
    expect(result.gaps[1].score).toBeGreaterThanOrEqual(80);
    expect(result.journey.primary.status).toBe("complete");
    expect(result.journey.primary.clicksToInterface).toBe(3);
    expect(result.journey.primaryConversionType).toBe("Add to cart");
  });

  it("selects a linked category and product when Firecrawl returns rendered Markdown instead of anchors", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const requestUrl = String(input);
      const body = JSON.parse(String(init?.body || "{}")) as { url?: string };
      if (requestUrl.endsWith("/crawl") && init?.method === "POST") {
        return new Response(JSON.stringify({ success: true, id: "woonwinkel-job" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (requestUrl.endsWith("/crawl/woonwinkel-job")) {
        return new Response(JSON.stringify({ status: "completed", data: [
          { html: '<input type="search" placeholder="Waar ben je naar op zoek?">', markdown: "# Zomer bij Woonwinkel\n[Ontdek assortiment](/collectie/zomer)\n[Buitenkaars](/nl/wonen/buitenkaars-123) 16,95\n[Dienblad](/nl/wonen/dienblad-456) 12,95", links: ["https://woonwinkel.nl/collectie/zomer", "https://woonwinkel.nl/nl/wonen/buitenkaars-123"], metadata: { sourceURL: "https://woonwinkel.nl/", title: "Woonwinkel", description: "Producten voor wonen en koken", statusCode: 200 } },
          { html: "", markdown: "# Zomercollectie\nProducten voor buiten, picknick en tuin.\n[Buitenkaars](/nl/wonen/buitenkaars-123) 16,95\n[Dienblad](/nl/wonen/dienblad-456) 12,95", links: ["https://woonwinkel.nl/nl/wonen/buitenkaars-123"], metadata: { sourceURL: "https://woonwinkel.nl/collectie/zomer", title: "Zomercollectie", statusCode: 200 } },
          { html: "", markdown: "# Buitenkaars\nDuurzame buitenkaars voor lange zomeravonden.\n[In winkelmand](/cart)", links: [], metadata: { sourceURL: "https://woonwinkel.nl/nl/wonen/buitenkaars-123", title: "Buitenkaars", statusCode: 200 } },
        ] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (requestUrl.endsWith("/map")) {
        return new Response(JSON.stringify({ success: true, links: [
          { url: "https://woonwinkel.nl/collectie/zomer", title: "Zomercollectie" },
          { url: "https://woonwinkel.nl/nl/wonen/buitenkaars-123", title: "Buitenkaars", description: "16,95" },
        ] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (requestUrl.endsWith("/scrape") && body.url === "https://woonwinkel.nl") {
        return new Response(JSON.stringify({ success: true, data: { html: '<input type="search" placeholder="Waar ben je naar op zoek?">', markdown: "# Zomer bij Woonwinkel\n[Ontdek assortiment](/collectie/zomer)\n[Buitenkaars](/nl/wonen/buitenkaars-123) 16,95\n[Dienblad](/nl/wonen/dienblad-456) 12,95", links: [], metadata: { sourceURL: "https://woonwinkel.nl/", title: "Woonwinkel", description: "Producten voor wonen en koken", statusCode: 200 } } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (requestUrl.endsWith("/scrape") && body.url === "https://woonwinkel.nl/collectie/zomer") {
        return new Response(JSON.stringify({ success: true, data: { html: "", markdown: "# Zomercollectie\n[Buitenkaars](/nl/wonen/buitenkaars-123) 16,95", links: [], metadata: { sourceURL: body.url, title: "Zomercollectie", statusCode: 200 } } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (requestUrl.endsWith("/scrape") && body.url === "https://woonwinkel.nl/nl/wonen/buitenkaars-123") {
        return new Response(JSON.stringify({ success: true, data: { html: "", markdown: "# Buitenkaars\nDuurzame buitenkaars voor lange zomeravonden.\n[In winkelmand](/cart)", links: [], metadata: { sourceURL: body.url, title: "Buitenkaars", statusCode: 200 } } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${requestUrl} ${body.url || ""}`);
    });

    const crawled = await crawlWebsite("https://woonwinkel.nl", "test-key", { fallbackWait: 100 });
    expect(crawled.map((item) => item.url)).toEqual([
      "https://woonwinkel.nl/",
      "https://woonwinkel.nl/collectie/zomer",
      "https://woonwinkel.nl/nl/wonen/buitenkaars-123",
    ]);
    const result = analyzeCrawl(crawled, "https://woonwinkel.nl/", 200);
    expect(result.journey.primary.status).toBe("complete");
    expect(result.journey.primary.clicksToInterface).toBe(3);
  });

  it("follows canonical www storefront links when Firecrawl Map is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const requestUrl = String(input);
      const body = JSON.parse(String(init?.body || "{}")) as { url?: string };
      if (requestUrl.endsWith("/crawl") && init?.method === "POST") {
        return new Response(JSON.stringify({ success: true, id: "canonical-storefront-job" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (requestUrl.endsWith("/crawl/canonical-storefront-job")) {
        return new Response(JSON.stringify({ status: "completed", data: [
          { html: '<input type="search" placeholder="Waar ben je naar op zoek?">', markdown: "# Dille & Kamille\n[Alle categorieën](https://www.dille-kamille.nl/nl/keuken)\n[Buitenkaars](https://www.dille-kamille.nl/nl/tuin/buitenkaars) 16,95\n[Dienblad](https://www.dille-kamille.nl/nl/keuken/dienblad) 16,95", links: ["https://www.dille-kamille.nl/nl/keuken", "https://www.dille-kamille.nl/nl/tuin/buitenkaars"], metadata: { sourceURL: "https://www.dille-kamille.nl/", title: "Dille & Kamille", description: "Producten voor huis en tuin", statusCode: 200 } },
          { html: "", markdown: "# Keuken\nBekijk ons brede assortiment pannen, servies en keukenproducten voor dagelijks koken, bakken en tafelen.\n[Pan](https://www.dille-kamille.nl/nl/keuken/pan) 29,95\n[Servies](https://www.dille-kamille.nl/nl/keuken/servies) 12,95", links: ["https://www.dille-kamille.nl/nl/keuken/pan"], metadata: { sourceURL: "https://www.dille-kamille.nl/nl/keuken", title: "Keuken", statusCode: 200 } },
          { html: "", markdown: "# Pan\nGietijzeren pan voor dagelijks koken, bakken en serveren. Bekijk de productdetails, prijs en beschikbaarheid voordat je bestelt. 29,95\n[In winkelmand](/cart)", links: ["https://www.dille-kamille.nl/cart"], metadata: { sourceURL: "https://www.dille-kamille.nl/nl/keuken/pan", title: "Pan", statusCode: 200 } },
        ] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (requestUrl.endsWith("/map")) {
        return new Response(JSON.stringify({ success: false, error: "Map unavailable" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (requestUrl.endsWith("/scrape") && body.url === "https://dille-kamille.nl") {
        return new Response(JSON.stringify({ success: true, data: {
          html: '<input type="search" placeholder="Waar ben je naar op zoek?">',
          markdown: "# Dille & Kamille\n[Alle categorieën](https://www.dille-kamille.nl/nl/keuken)\n[Buitenkaars](https://www.dille-kamille.nl/nl/tuin/buitenkaars) 16,95\n[Dienblad](https://www.dille-kamille.nl/nl/keuken/dienblad) 16,95",
          links: ["https://www.dille-kamille.nl/nl/keuken", "https://www.dille-kamille.nl/nl/tuin/buitenkaars"],
          metadata: { sourceURL: "https://www.dille-kamille.nl/", title: "Dille & Kamille", description: "Producten voor huis en tuin", statusCode: 200 },
        } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (requestUrl.endsWith("/scrape") && body.url === "https://www.dille-kamille.nl/nl/keuken") {
        return new Response(JSON.stringify({ success: true, data: {
          html: "", markdown: "# Keuken\nBekijk ons brede assortiment pannen, servies en keukenproducten voor dagelijks koken, bakken en tafelen.\n[Pan](https://www.dille-kamille.nl/nl/keuken/pan) 29,95\n[Servies](https://www.dille-kamille.nl/nl/keuken/servies) 12,95", links: ["https://www.dille-kamille.nl/nl/keuken/pan"],
          metadata: { sourceURL: body.url, title: "Keuken", statusCode: 200 },
        } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (requestUrl.endsWith("/scrape") && body.url === "https://www.dille-kamille.nl/nl/keuken/pan") {
        return new Response(JSON.stringify({ success: true, data: {
          html: "", markdown: "# Pan\nGietijzeren pan voor dagelijks koken, bakken en serveren. Bekijk de productdetails, prijs en beschikbaarheid voordat je bestelt. 29,95\n[In winkelmand](/cart)", links: ["https://www.dille-kamille.nl/cart"],
          metadata: { sourceURL: body.url, title: "Pan", statusCode: 200 },
        } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${requestUrl} ${body.url || ""}`);
    });

    const crawled = await crawlWebsite("https://dille-kamille.nl", "test-key", { fallbackWait: 100 });
    expect(crawled.map((item) => item.url)).toEqual([
      "https://www.dille-kamille.nl/",
      "https://www.dille-kamille.nl/nl/keuken",
      "https://www.dille-kamille.nl/nl/keuken/pan",
    ]);
    const result = analyzeCrawl(crawled, "https://dille-kamille.nl/", 200);
    expect(result.score).not.toBeNull();
    expect(result.journey.primary.status).toBe("complete");
    expect(result.journey.primary.clicksToInterface).toBe(4);
  });

  it("never starts an ecommerce journey at cart or checkout", () => {
    const pages = [
      page({ url: "https://winkel.nl/", title: "Winkel", links: ["https://winkel.nl/cart", "https://winkel.nl/checkout"], html: '<h1>Winkel</h1><p>Online winkel met een uitgebreid assortiment producten voor wonen, koken en tafelen, met duidelijke informatie voor Nederlandse consumenten.</p><a href="/cart">Winkelmand</a><a href="/checkout">Afrekenen</a>' }),
      page({ url: "https://winkel.nl/cart", title: "Winkelmand", links: ["https://winkel.nl/checkout"], html: '<h1>Winkelmand</h1><p>Je winkelmand is leeg. Voeg eerst een product toe vanuit een categorie of productpagina voordat je deze bestelling kunt afronden.</p><a href="/checkout">Afrekenen</a>' }),
      page({ url: "https://winkel.nl/checkout", title: "Checkout", html: '<h1>Afrekenen</h1><p>Vul je gegevens pas in nadat je vanuit het assortiment een product hebt gekozen en bewust aan de winkelmand hebt toegevoegd.</p>' }),
    ];
    const result = analyzeCrawl(pages, "https://winkel.nl/", 200);
    expect(result.journey.primary.status).toBe("incomplete");
    expect(result.journey.primary.clicksToInterface).toBeNull();
    expect(result.gaps[2].score).toBe(10);
    expect(result.gaps[2].evidence[0].statement).not.toMatch(/cart → checkout/i);
  });

  it("builds a four-step ecommerce path through category, product and Add to cart", () => {
    const pages = [
      page({ url: "https://winkel.nl/", title: "Voorbeeldwinkel", links: ["https://winkel.nl/collecties/keuken"], html: '<html><body><h1>Wonen en keuken</h1><p>Shop onze collectie woonaccessoires en keukenproducten.</p><a href="/collecties/keuken">Bekijk collectie</a></body></html>' }),
      page({ url: "https://winkel.nl/collecties/keuken", title: "Keuken", links: ["https://winkel.nl/products/pan"], html: '<html><body><h1>Keuken</h1><p>Bekijk producten voor koken en tafelen.</p><a href="/products/pan">Bekijk pan</a></body></html>' }),
      page({ url: "https://winkel.nl/products/pan", title: "Pan", links: ["https://winkel.nl/cart"], html: '<html><body><h1>Pan</h1><p>Een pan voor dagelijks koken.</p><a href="/cart">In winkelmand</a></body></html>' }),
      page({ url: "https://winkel.nl/cart", title: "Winkelmand", links: ["https://winkel.nl/checkout"], html: '<html><body><h1>Winkelmand</h1><p>Pan, aantal 1. Controleer uw bestelling.</p><a href="/checkout">Naar de kassa</a></body></html>' }),
      page({ url: "https://winkel.nl/checkout", title: "Afrekenen", html: '<html><body><h1>Afrekenen</h1><form><input name="email" required><input name="address" required><button>Bestelling plaatsen</button></form></body></html>' }),
    ];
    const result = analyzeCrawl(pages, "https://winkel.nl/", 500);

    expect(result.journey.businessModels).toContain("Ecommerce");
    expect(result.journey.primaryConversionType).toBe("Add to cart");
    expect(result.journey.primary.status).toBe("complete");
    expect(result.journey.primary.clicksToInterface).toBe(4);
    expect(result.journey.primary.stages.map((stage) => stage.pageType)).toEqual(["Homepage", "Category", "Product", "Conversion"]);
    expect(result.journey.primary.additionalObservableActions).toBeNull();
    expect(result.gaps.map((gap) => gap.title)).toEqual(["Offer Clarity", "CTA Clarity", "Customer Journey Path"]);
    expect(result.gaps.map((gap) => `${gap.summary} ${gap.nextAction}`).join(" ")).not.toMatch(/service page|offerte|quote|contact path/i);
    expect(result.gaps.find((gap) => gap.id === "cta-clarity")?.evidence.map((item) => item.pageLabel)).toEqual(["Product discovery", "Product selection", "Add to cart"]);
  });

  it("does not let a directly scraped empty cart shorten a valid Add to cart path", () => {
    const pages = [
      page({ url: "https://winkel.nl/", title: "Winkel", links: ["https://winkel.nl/collecties/keuken", "https://winkel.nl/cart"], html: '<h1>Wonen en keuken</h1><p>Ontdek ons uitgebreide assortiment voor koken, tafelen en wonen met duidelijke productinformatie.</p><a href="/collecties/keuken">Keuken</a><a href="/cart">Winkelmand</a>' }),
      page({ url: "https://winkel.nl/collecties/keuken", title: "Keuken", links: ["https://winkel.nl/products/pan"], html: '<h1>Keuken</h1><p>Bekijk pannen en keukenproducten voor dagelijks koken, uitgebreid beschreven voor consumenten.</p><a href="/products/pan">Pan</a>' }),
      page({ url: "https://winkel.nl/products/pan", title: "Pan", links: ["https://winkel.nl/cart"], html: '<h1>Pan</h1><p>Deze duurzame pan is geschikt voor dagelijks koken en bevat uitgebreide productinformatie.</p><a href="/cart">In winkelmand</a>' }),
      page({ url: "https://winkel.nl/cart", title: "Winkelmand", links: ["https://winkel.nl/checkout"], html: '<h1>Winkelmand</h1><p>Je winkelmand is leeg. Voeg eerst een product toe voordat je veilig kunt doorgaan met bestellen.</p><a href="/checkout">Naar de kassa</a>' }),
      page({ url: "https://winkel.nl/checkout", title: "Checkout", html: '<h1>Afrekenen</h1><p>Vul na een geldige winkelmand je gegevens in om de bestelling veilig af te ronden.</p>' }),
    ];
    const result = analyzeCrawl(pages, "https://winkel.nl/", 300);
    const journeyFinding = result.gaps.find((gap) => gap.id === "customer-journey-path")!;
    expect(result.journey.primary.status).toBe("complete");
    expect(result.journey.primary.clicksToInterface).toBe(4);
    expect(result.journey.primaryConversionType).toBe("Add to cart");
    expect(journeyFinding.evidence[0].statement).toMatch(/4 steps/i);
    expect(result.journey.primary.stages.some((stage) => stage.pageType === "Cart" || stage.pageType === "Checkout")).toBe(false);
  });

  it("counts landing, category, product and Add to cart as four steps", () => {
    const pages = [
      page({ url: "https://winkel.nl/", title: "Winkel", links: ["https://winkel.nl/collecties/keuken", "https://winkel.nl/cart"], html: '<h1>Wonen en keuken</h1><p>Ontdek producten voor thuis met snelle levering en duidelijke informatie voor consumenten.</p><a href="/collecties/keuken">Keuken</a><a href="/cart">Winkelmand</a>' }),
      page({ url: "https://winkel.nl/collecties/keuken", title: "Keuken", links: ["https://winkel.nl/products/pan"], html: '<h1>Keukenproducten</h1><p>Bekijk het complete assortiment voor dagelijks koken en tafelen in huis.</p><a href="/products/pan">Bekijk pan</a>' }),
      page({ url: "https://winkel.nl/products/pan", title: "Pan", html: '<h1>Duurzame pan</h1><p>Een duurzame kwaliteitspan voor dagelijks koken met uitgebreide productinformatie.</p><button>In winkelmand</button>' }),
      page({ url: "https://winkel.nl/cart", title: "Winkelmand", links: ["https://winkel.nl/checkout"], html: '<h1>Winkelmand</h1><p>Pan, aantal 1. De bestelling staat klaar om veilig te worden afgerekend.</p><a href="/checkout">Naar de kassa</a>' }),
      page({ url: "https://winkel.nl/checkout", title: "Checkout", html: '<h1>Afrekenen</h1><p>Vul je gegevens in om de bestelling veilig en snel af te ronden.</p>' }),
    ];
    const result = analyzeCrawl(pages, "https://winkel.nl/", 300);
    expect(result.journey.primary.status).toBe("complete");
    expect(result.journey.primary.clicksToInterface).toBe(4);
    expect(result.gaps.find((gap) => gap.id === "customer-journey-path")?.evidence[0].statement).toMatch(/4 steps/i);
  });

  it("explains landing-page offer and conversion intent", () => {
    const result = analyzeCrawl(scoredSite({ trustOnContact: true }), "https://voorbeeld.nl/", 300);
    const offer = result.gaps.find((gap) => gap.id === "offer-clarity")!;
    expect(offer.evidence).toHaveLength(2);
    expect(offer.evidence.map((item) => item.pageLabel)).toEqual(["Landing-page offer", "Conversion intent"]);
    expect(offer.summary).toMatch(/landing page/i);
    expect(offer.nextAction.length).toBeGreaterThan(20);
  });

  it("recognizes a retail homepage with product cards and ignores utility forms", () => {
    const retailHome = page({
      url: "https://retailer.nl/",
      title: "Retailer",
      description: "Ontdek een assortiment voor wonen, koken, tafelen, cadeaus en buiten.",
      links: ["https://retailer.nl/nl/wonen/buitenkaars-123", "https://retailer.nl/nl/keuken/servies-456"],
      markdown: "Ontdek ons assortiment\nBuitenkaars € 16,95\nServies € 12,95\nWonen, koken, tafelen en cadeaus",
      html: `<html><body>
        <h1>Retailer</h1>
        <form action="/search"><input name="query" placeholder="Waar ben je naar op zoek?"></form>
        <form action="/newsletter"><input name="email"><button>Nieuwsbrief inschrijven</button></form>
        <a href="/nl/wonen/buitenkaars-123">Buitenkaars € 16,95</a>
        <a href="/nl/keuken/servies-456">Servies € 12,95</a>
        <a href="/nl/assortiment">Ontdek ons assortiment</a>
      </body></html>`,
    });
    const result = analyzeCrawl([retailHome], "https://retailer.nl/", 250);
    const entity = buildDeterministicEntityProfile(result, [retailHome]);

    expect(classifyCommercialModel([retailHome])).toBe("ecommerce");
    expect(result.journey.businessModels).toContain("Ecommerce");
    expect(result.journey.primaryConversionType).not.toBe("Lead form");
    expect(result.overview.estimatedClicks).toBeNull();
    expect(result.readiness.status).toBe("insufficient-data");
    expect(result.readiness.categories.find((category) => category.id === "customer-journey-path")?.score).toBeNull();
    expect(result.readiness.categories.find((category) => category.id === "cta-clarity")?.score).toBeNull();
    expect(entity.businessModel).toBe("retail-ecommerce");
    expect(entity.industry).toBe("Home and lifestyle retail");
    expect(entity.offerings).toContain("woonaccessoires");
  });
});

describe("timeout resilience", () => {
  it("returns completed partial crawl evidence instead of inventing missing pages", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const requestUrl = String(input);
      if (requestUrl.endsWith("/crawl") && init?.method === "POST") {
        return new Response(JSON.stringify({ success: true, id: "partial-job" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (requestUrl.endsWith("/crawl/partial-job")) {
        return new Response(JSON.stringify({ status: "completed", data: [{
          markdown: "Warmtepompinstallatie voor woningen in Utrecht.",
          html: "<html><body><h1>Warmtepompinstallatie voor woningen</h1></body></html>",
          links: [],
          metadata: { sourceURL: "https://voorbeeld.nl/", title: "Voorbeeld", statusCode: 200 },
        }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (requestUrl.endsWith("/scrape")) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            markdown: "Warmtepompinstallatie voor woningen in Utrecht.",
            html: "<html><body><h1>Warmtepompinstallatie voor woningen</h1></body></html>",
            links: [],
            metadata: { sourceURL: "https://voorbeeld.nl/", title: "Voorbeeld", statusCode: 200 },
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (requestUrl.endsWith("/map")) {
        return new Response(JSON.stringify({ error: "Map unavailable" }), { status: 502, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const pages = await crawlWebsite("https://voorbeeld.nl", "test-key", { fallbackWait: 100 });
    expect(pages).toHaveLength(1);
    expect(pages[0].url).toBe("https://voorbeeld.nl/");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([input]) => String(input).includes("/crawl"))).toBe(true);
  });

  it("turns a non-JSON Vercel timeout response into a readable message", async () => {
    const response = new Response("An error occurred with your deployment", { status: 504, headers: { "Content-Type": "text/plain" } });
    await expect(readAnalysisResponse(response)).rejects.toThrow("The scan took too long");
  });

  it("preserves a structured API error message", async () => {
    const response = new Response(JSON.stringify({ error: "Firecrawl is temporarily unavailable." }), { status: 502, headers: { "Content-Type": "application/json" } });
    await expect(readAnalysisResponse(response)).rejects.toThrow("Firecrawl is temporarily unavailable.");
  });
});
