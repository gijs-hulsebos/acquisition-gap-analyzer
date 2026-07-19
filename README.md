# Acquisition Gap Analyzer

A small MVP that analyzes one public website and returns three acquisition findings.

## Saved demo

The demo opens instantly without calling Firecrawl or OpenRouter. It compares preloaded Dille & Kamille findings with preloaded Søstrene Grene findings, making it reliable for product videos.

## Flow

1. The user submits a URL.
2. One bounded Firecrawl job reads up to eight representative pages on that domain.
3. Deterministic extraction builds evidence for the landing-page offer, CTAs and customer journey.
4. OpenRouter optionally rewrites the finished findings in concise language without changing scores or evidence.
5. The dashboard shows the overview, three findings and crawl details.
6. After the main report is complete, the user may enter one competitor URL.
7. The same `analyzeWebsite` pipeline runs for that URL: one crawl, the same deterministic analysis and the same optional OpenRouter wording pass.
8. The dashboard compares both websites using the same three findings, evidence and journey estimate.

## Findings

- **Offer Clarity** — whether the landing page quickly communicates what the website offers.
- **CTA Clarity** — whether the commercial calls to action are specific and consistent.
- **Customer Journey Path** — estimated clicks from the landing page to checkout, starting with an empty cart. For non-ecommerce websites it estimates the path to the primary conversion interface.

The analyzer first reads public HTML, Markdown and links. If those pages cannot establish a complete ecommerce route, one bounded active journey verifier attempts the path from an empty cart to checkout using visible controls. It never enters personal or payment data and never places an order. A journey receives a click count only when every performed action is returned with an Add-to-cart action, cart stage and checkout stage; otherwise it remains `Incomplete journey`.

Competitor analysis is optional and never delays or changes the original report. There is no automatic competitor search: the user supplies the comparison URL. The session-only result is not stored in a database.

## Backend structure

- `analyzeWebsite(url)` is the only live analysis pipeline, including the conditional journey verifier.
- `/api/analyze` returns the complete company report.
- `/api/compare` runs the same pipeline and returns comparison data.
- Transient Firecrawl 429/502/503/504 responses are retried twice.
- Crawl options are supplied directly; no extra Firecrawl prompt-generation step is used.
- Crawl concurrency is limited and cached page content may be reused for faster, more stable scans.
- OpenRouter changes wording only; it cannot change scores, evidence or click counts.

## Environment

```env
FIRECRAWL_API_KEY=
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openai/gpt-4.1-mini
```

`FIRECRAWL_API_KEY` is required for live scans. OpenRouter is optional; without it, the deterministic report is returned unchanged.

## Development

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run build
```

Open `http://localhost:3000`.
