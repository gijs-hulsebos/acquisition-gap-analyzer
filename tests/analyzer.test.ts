import { describe, expect, it } from "vitest";
import { analyzeCrawl } from "../lib/analyzer";
import { filterCompetitorCandidates, selectDirectCompetitor } from "../lib/competitor-scan";
import { signCompetitorJob, verifyCompetitorJob } from "../lib/competitor-token";
import type { CrawlPage } from "../lib/types";

function page(url: string, title: string, html: string, links: string[] = []): CrawlPage {
  return { url, title, description: "", html, markdown: "", links, statusCode: 200 };
}

function ecommercePages(addLabel = "In winkelmandje") {
  return [
    page("https://shop.nl/", "Simple Shop", `
      <h1>Keukenproducten voor dagelijks gebruik</h1>
      <a href="/keuken">Bekijk keukenproducten</a>
      <span>€ 12,95</span><span>€ 19,95</span>
      <p>Ontdek ons complete assortiment praktische keukenproducten voor koken, bakken en tafelen.</p>
    `, ["https://shop.nl/keuken"]),
    page("https://shop.nl/keuken", "Keuken", `
      <h1>Keuken</h1><a href="/product/pan">Gietijzeren pan</a>
      <span>€ 49,95</span><span>€ 59,95</span>
      <p>Bekijk duurzame pannen en accessoires voor iedere dagelijkse maaltijd in de keuken.</p>
    `, ["https://shop.nl/product/pan"]),
    page("https://shop.nl/product/pan", "Gietijzeren pan", `
      <h1>Gietijzeren pan</h1><p>Een duurzame pan voor thuis.</p>
      <p>Geschikt voor dagelijks koken en gemaakt om jarenlang met plezier te blijven gebruiken.</p>
      <button>${addLabel}</button>
    `),
    page("https://shop.nl/cart", "Winkelmandje", `<h1>Winkelmandje</h1><a href="/checkout">Afrekenen</a>`),
    page("https://shop.nl/checkout", "Afrekenen", `<h1>Afrekenen</h1><p>Vul je gegevens in om te bestellen.</p>`),
  ];
}

describe("simple acquisition report", () => {
  it("always returns exactly the three requested findings", () => {
    const result = analyzeCrawl(ecommercePages(), "https://shop.nl/", 100);
    expect(result.gaps.map((gap) => gap.id)).toEqual([
      "offer-clarity",
      "cta-clarity",
      "customer-journey-path",
    ]);
  });

  it("scores offer clarity from the landing page", () => {
    const result = analyzeCrawl(ecommercePages(), "https://shop.nl/", 100);
    expect(result.gaps[0].score).not.toBeNull();
    expect(result.gaps[0].evidence.every((item) => item.url === "https://shop.nl/")).toBe(true);
  });

  it("detects Dutch Add to cart wording", () => {
    const result = analyzeCrawl(ecommercePages("Voeg toe aan winkelwagen"), "https://shop.nl/", 100);
    expect(result.gaps[1].evidence.some((item) => item.statement.includes("Voeg toe aan winkelwagen"))).toBe(true);
  });

  it("scores CTA wording independently from the journey path", () => {
    const direct = analyzeCrawl(ecommercePages("Koop nu"), "https://shop.nl/", 100);
    const generic = analyzeCrawl(ecommercePages("Meer informatie"), "https://shop.nl/", 100);
    expect(direct.gaps[1].score).toBeGreaterThan(generic.gaps[1].score || 0);
    expect(direct.gaps[1].summary).toContain("Koop nu");
  });

  it("counts an empty-cart category journey through checkout as five clicks", () => {
    const result = analyzeCrawl(ecommercePages(), "https://shop.nl/", 100);
    expect(result.overview.primaryConversion).toBe("Checkout");
    expect(result.overview.estimatedClicks).toBe(5);
  });

  it("estimates the journey when a dynamic Add to cart label is not captured", () => {
    const result = analyzeCrawl(ecommercePages("Kies product"), "https://shop.nl/", 100);
    expect(result.journey.primary.status).toBe("complete");
    expect(result.overview.estimatedClicks).toBe(5);
    expect(result.journey.primary.limitations[0]).toContain("not clicked");
  });

  it("returns insufficient data when fewer than two useful pages are available", () => {
    const result = analyzeCrawl(ecommercePages().slice(0, 1), "https://shop.nl/", 100);
    expect(result.score).toBeNull();
    expect(result.readiness.status).toBe("insufficient-data");
  });
});

describe("optional competitor scan", () => {
  it("rejects the submitted domain, directories and duplicate domains", () => {
    const candidates = filterCompetitorCandidates([
      { title: "Submitted company", description: "", url: "https://shop.nl/products" },
      { title: "Review", description: "", url: "https://trustpilot.com/review/shop.nl" },
      { title: "Direct competitor", description: "Similar Dutch shop", url: "https://competitor.nl/products" },
      { title: "Duplicate result", description: "", url: "https://competitor.nl/about" },
    ], "https://shop.nl/");
    expect(candidates).toEqual([{ title: "Direct competitor", description: "Similar Dutch shop", url: "https://competitor.nl" }]);
  });

  it("selects only one competitor", async () => {
    const selected = await selectDirectCompetitor({
      url: "https://shop.nl/",
      companyName: "Simple Shop",
      primaryOffer: "Kitchen products and cookware",
      businessModel: "Ecommerce",
    }, [
      { title: "Kitchen Store", description: "Dutch kitchen products and cookware", url: "https://kitchen-store.nl" },
      { title: "Furniture Store", description: "Dutch furniture", url: "https://furniture-store.nl" },
    ]);
    expect(selected?.url).toBe("https://kitchen-store.nl");
  });

  it("signs crawl state and rejects a modified job token", () => {
    const state = {
      version: 1 as const,
      issuedAt: Date.now(),
      sourceUrl: "https://shop.nl",
      competitor: { name: "Kitchen Store", url: "https://kitchen-store.nl" },
      job: { id: "crawl-123", rootUrl: "https://kitchen-store.nl", pageLimit: 3 },
    };
    const token = signCompetitorJob(state, "test-secret");
    expect(verifyCompetitorJob(token, "test-secret")).toEqual(state);
    expect(() => verifyCompetitorJob(`${token}x`, "test-secret")).toThrow("Invalid competitor scan token");
  });
});
