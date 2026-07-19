import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeCrawl } from "../lib/analyzer";
import { DEMO_COMPETITOR_RESULT, DEMO_RESULT } from "../lib/fixture";
import { getWebsiteCrawlProgress, startWebsiteCrawl } from "../lib/firecrawl";
import type { CrawlPage } from "../lib/types";

function page(url: string, title: string, html: string, links: string[] = []): CrawlPage {
  return { url, title, description: "", html, markdown: "", links, statusCode: 200 };
}

afterEach(() => vi.unstubAllGlobals());

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
      <button>${addLabel}</button><a href="/cart">Winkelmandje</a>
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

  it("accepts a landing-page Add to cart action as a complete three-click journey", () => {
    const pages = [
      page("https://direct-shop.nl/", "Direct Shop", `
        <h1>Woonaccessoires en producten voor thuis</h1>
        <p>Bekijk onze collectie woonartikelen voor ieder interieur.</p>
        <span>€ 1,69</span><span>€ 3,22</span>
        <div class="product-card">Lepel</div>
        <button>Add to Cart: Lepel</button><a href="/cart">Cart</a>
      `),
      page("https://direct-shop.nl/cart", "Cart", `<h1>Cart</h1><p>Review the selected product and order total before continuing.</p><a href="/checkout">Checkout</a>`),
      page("https://direct-shop.nl/checkout", "Checkout", `<h1>Checkout</h1><p>Complete your order by entering the delivery and payment information requested below.</p>`),
    ];
    const result = analyzeCrawl(pages, "https://direct-shop.nl/", 100);
    expect(result.journey.primary.status).toBe("complete");
    expect(result.overview.estimatedClicks).toBe(3);
    expect(result.gaps[1].score).toBe(100);
    expect(result.journey.primary.stages[0].pageType).toBe("Homepage");
  });

  it("does not assign a click count when Add to cart is not evidenced", () => {
    const result = analyzeCrawl(ecommercePages("Kies product"), "https://shop.nl/", 100);
    expect(result.journey.primary.status).toBe("incomplete");
    expect(result.overview.estimatedClicks).toBeNull();
    expect(result.journey.primary.limitations[0]).toContain("No click count is shown");
  });

  it("does not treat non-clickable Add to cart text as a three-click journey", () => {
    const pages = [
      page("https://text-only-shop.nl/", "Text Only Shop", `<h1>Products for home</h1><p>Add to cart appears in descriptive content but is not a button.</p><a href="/cart">Cart</a>`),
      page("https://text-only-shop.nl/cart", "Cart", `<h1>Cart</h1><p>Review the items in your shopping cart before continuing.</p><a href="/checkout">Checkout</a>`),
      page("https://text-only-shop.nl/checkout", "Checkout", `<h1>Checkout</h1><p>Enter delivery and payment details to finish the purchase.</p>`),
    ];
    const result = analyzeCrawl(pages, "https://text-only-shop.nl/", 100);
    expect(result.overview.estimatedClicks).toBeNull();
    expect(result.journey.primary.status).toBe("incomplete");
  });

  it("returns insufficient data when fewer than two useful pages are available", () => {
    const result = analyzeCrawl(ecommercePages().slice(0, 1), "https://shop.nl/", 100);
    expect(result.score).toBeNull();
    expect(result.readiness.status).toBe("insufficient-data");
  });
});

describe("optional competitor scan", () => {
  it("ships an instant saved Dille & Kamille versus Søstrene Grene demo", () => {
    const competitor = DEMO_COMPETITOR_RESULT.competitor;
    expect(DEMO_RESULT.mode).toBe("fixture");
    expect(DEMO_RESULT.companyName).toBe("Dille & Kamille");
    expect(competitor).not.toBeNull();
    expect(competitor?.name).toBe("Søstrene Grene");
    expect(competitor?.estimatedClicks).toBe(3);
    expect(competitor?.findings).toHaveLength(3);
  });
  it("runs the identical three findings for a supplied comparison website", () => {
    const competitor = analyzeCrawl(ecommercePages(), "https://shop.nl/", 0);
    expect(competitor.gaps.map((finding) => finding.id)).toEqual([
      "offer-clarity",
      "cta-clarity",
      "customer-journey-path",
    ]);
    expect(competitor.overview.estimatedClicks).toBe(5);
    expect(competitor.pages).toHaveLength(5);
  });

});

describe("localized crawl seeds", () => {
  it("retries a transient Firecrawl 502 before succeeding", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Bad gateway" }), { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, id: "crawl-retried" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const job = await startWebsiteCrawl("https://shop.nl", "test-key");

    expect(job.id).toBe("crawl-retried");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves a submitted locale path when starting Firecrawl", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, id: "crawl-locale" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const job = await startWebsiteCrawl("https://sostrenegrene.com/nl", "test-key");
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { url: string };

    expect(request.url).toBe("https://sostrenegrene.com/nl");
    expect(job.rootUrl).toBe("https://sostrenegrene.com/nl");
  });

  it("selects the submitted locale page as the homepage instead of the global root", async () => {
    const payload = {
      status: "completed",
      data: [
        { markdown: "Global selector", html: "<h1>All over the world</h1>", metadata: { sourceURL: "https://sostrenegrene.com/", title: "All over the world" } },
        { markdown: "Dutch products", html: "<h1>Søstrene Grene Nederland</h1>", metadata: { sourceURL: "https://sostrenegrene.com/nl", title: "Søstrene Grene Nederland" } },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 })));

    const progress = await getWebsiteCrawlProgress({ id: "crawl-locale", rootUrl: "https://sostrenegrene.com/nl", pageLimit: 8 }, "test-key");

    expect(progress.pages[0]?.url).toBe("https://sostrenegrene.com/nl");
    expect(progress.pages[0]?.title).toBe("Søstrene Grene Nederland");
  });
});
