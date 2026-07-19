import { describe, expect, it } from "vitest";
import { analyzeCrawl } from "../lib/analyzer";
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

function directProductPages(homepageAdd = false) {
  const homepageButton = homepageAdd ? `<button aria-label="In winkelmandje"></button>` : "";
  return [
    page("https://direct-shop.nl/", "Direct Shop", `
      <h1>Producten voor iedere dag</h1>
      <article class="product-card">
        <a href="/product/lepel">Glazen lepel</a><span>€ 1,69</span>${homepageButton}
      </article>
      <article class="product-card"><a href="/product/beker">Glazen beker</a><span>€ 3,49</span></article>
      <p>Bekijk en bestel ons complete assortiment praktische producten.</p>
    `, ["https://direct-shop.nl/product/lepel", "https://direct-shop.nl/product/beker"]),
    page("https://direct-shop.nl/product/lepel", "Glazen lepel", `
      <h1>Glazen lepel</h1><p>Een praktische glazen lepel voor dagelijks gebruik.</p>
      <button>In winkelmandje</button>
    `),
    page("https://direct-shop.nl/cart", "Winkelmandje", `<h1>Winkelmandje</h1><a href="/checkout">Afrekenen</a>`),
    page("https://direct-shop.nl/checkout", "Afrekenen", `<h1>Afrekenen</h1><p>Vul je gegevens in om te bestellen.</p>`),
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

  it("counts a landing-page Add to cart route one click shorter than opening a product first", () => {
    const landingPageAdd = analyzeCrawl(directProductPages(true), "https://direct-shop.nl/", 100);
    const productPageAdd = analyzeCrawl(directProductPages(false), "https://direct-shop.nl/", 100);

    expect(landingPageAdd.overview.estimatedClicks).toBe(3);
    expect(productPageAdd.overview.estimatedClicks).toBe(4);
    expect(productPageAdd.overview.estimatedClicks! - landingPageAdd.overview.estimatedClicks!).toBe(1);
    expect(landingPageAdd.journey.primary.stages.map((stage) => stage.pageType)).toEqual(["Homepage", "Cart", "Checkout"]);
    expect(landingPageAdd.journey.primary.stages[0].ctaText).toBe("In winkelmandje");
  });

  it("calculates the journey independently for a second scan", () => {
    const company = analyzeCrawl(directProductPages(false), "https://direct-shop.nl/", 100);
    const competitor = analyzeCrawl(directProductPages(true), "https://direct-shop.nl/", 100);

    expect(company.gaps.find((gap) => gap.id === "customer-journey-path")?.summary).toContain("4 clicks");
    expect(competitor.gaps.find((gap) => gap.id === "customer-journey-path")?.summary).toContain("3 clicks");
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
