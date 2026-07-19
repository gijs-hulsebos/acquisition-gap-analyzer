import { afterEach, describe, expect, it, vi } from "vitest";
import { crawlWebsite, startWebsiteCrawl } from "../lib/firecrawl";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Firecrawl website entry points", () => {
  it("preserves a submitted locale path when starting a crawl", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, id: "crawl-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await startWebsiteCrawl("https://example.com/nl", "key");

    const request = fetchMock.mock.calls[0];
    const body = JSON.parse(String(request[1]?.body)) as { url: string };
    expect(body.url).toBe("https://example.com/nl");
  });

  it("falls back to scraping the submitted page when a crawl returns no documents", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, id: "crawl-2" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "completed", data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        data: {
          markdown: "# Producten",
          html: "<h1>Producten</h1>",
          links: ["https://example.com/nl/products"],
          metadata: { sourceURL: "https://example.com/nl", title: "Nederland", statusCode: 200 },
        },
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const pages = await crawlWebsite("https://example.com/nl", "key");

    expect(pages).toHaveLength(1);
    expect(pages[0].url).toBe("https://example.com/nl");
    expect(fetchMock.mock.calls[2][0]).toBe("https://api.firecrawl.dev/v2/scrape");
  });
});
