# Acquisition Gap Analyzer

A full-stack MVP for Dutch SMEs. Enter a public company website and the app selects a bounded set of representative commercial pages, maps a conversion journey, and returns three deterministic evidence-backed findings.

The result is an MVP heuristic based on public website evidence. It is not conversion analytics and does not guarantee commercial performance.

## What is included

- Landing page with URL entry and saved demo mode
- Four-step loading experience
- `POST /api/analyze` endpoint with URL validation and local/private-address blocking
- Homepage-first business classification followed by up to eight representative same-domain pages
- Extraction of homepage, service/contact pages, CTAs, forms and internal links
- Three-metric weighted conversion-readiness overview
- Structured primary customer journey with required clicks, additional observable actions and ordered stages
- Exactly three evidence-backed findings: Offer Clarity, CTA Clarity and Customer Journey Path
- Visible trust-signal analysis on important commercial pages
- Entity-first comparison with up to two matching Dutch public-search competitors, each checked across representative pages
- Optional OpenRouter report-copy rewrite; it cannot generate, score, rank or rename findings
- Responsive dark dashboard with expandable evidence and crawl details

## Analysis categories

| Category | Weight | What is measured |
| --- | ---: | --- |
| Offer Clarity | 35% | Whether the title, main heading and description make the offer immediately understandable |
| CTA Clarity | 30% | Whether the landing page exposes a specific commercial action rather than generic prompts |
| Customer Journey Path | 35% | Shortest evidenced route from arrival to the primary conversion interface |

The score is calculated as:

```text
sum(category score x category weight) / sum(assessed category weights)
```

The three findings are always returned when a landing page can be read. A scored assessment requires at least three useful pages: readable pages with a successful HTTP response and enough visible content. With fewer than three, the score and all three finding scores are `null`, the report states `Insufficient data`, and the available evidence and recommendations remain visible. Confidence remains separate from the score.

The JSON response always contains the overview and the same three findings in the same order. Up to two likely public search competitors are evaluated with those same three deterministic checks. OpenRouter receives that finished JSON and may only shorten the report wording.

## Live-analysis flow

1. The server validates and normalizes the submitted URL.
2. Firecrawl resolves the submitted domain and scrapes its homepage first.
3. The landing-page evidence classifies the commercial model before any journey pages are selected: ecommerce, booking, software/subscription, marketplace, service or informational.
4. A model-specific representative-page plan is loaded. Ecommerce prioritizes category, one product, cart, checkout and trust/returns pages; services prioritize service overview/detail, quote/contact and trust/pricing pages; software prioritizes pricing, product/service, signup/demo and trust pages.
5. Firecrawl Map is used only as a same-domain lookup for those representative roles.
6. At most one representative product page is retained, preventing a product catalogue from crowding out journey evidence. Up to eight useful pages are returned.
7. A graph of those journey pages, links and observable cart/checkout actions is used to calculate the shortest realistic route.
8. The deterministic layer scores Offer Clarity, CTA Clarity and Customer Journey Path and emits the stable JSON report contract.
9. The company entity is resolved from first-party evidence into business type, primary offer, geography and target customer.
10. Firecrawl Search uses that resolved market profile instead of raw keywords and rejects directories, editorial/review results, incompatible business models, different local markets and unrelated offerings.
11. Up to two accepted competitor domains receive the same bounded representative crawl and the exact same three deterministic checks as the submitted company.
12. If OpenRouter is configured, it may rewrite summaries and recommended actions. IDs, titles, evidence, scores, severity and ranking remain unchanged.

If competitor discovery or OpenRouter fails, the deterministic website report is still returned.

## Scope and limitations

The current MVP:

- Detects HTML forms but does not submit them.
- Detects CTA text in HTML but does not prove that a CTA is visually prominent.
- Detects trust signals on the same important page but does not prove they are positioned beside the CTA or form.
- Analyzes at most eight representative journey pages after mapping the domain.
- Cannot confirm a conversion route that passes through pages outside the selected page set.
- Never places an order, creates an account, books an appointment or submits a form.
- May not observe personalized, logged-in, payment or JavaScript-only steps.
- Uses HTML/text heuristics rather than real visitor behaviour or conversion analytics.
- Resolves and filters competitor candidates more strictly, but still labels them `Likely public search competitors`; public evidence cannot confirm that they are direct commercial competitors.

It does not include a database, authentication, report history, email delivery, PDF export, analytics integration or scheduled monitoring.

## Run locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your own `.env.local` from `.env.example` and add at least a Firecrawl key:

   ```env
   FIRECRAWL_API_KEY=fc-your-key
   OPENROUTER_API_KEY=sk-or-v1-your-key
   OPENROUTER_MODEL=openai/gpt-4.1-mini
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

   `OPENROUTER_API_KEY` is optional. Without it, deterministic findings are returned unchanged.

3. Start the app:

   ```bash
   npm run dev
   ```

4. Open `http://localhost:3000`.

The saved demo works without API keys. Open `http://localhost:3000/?demo=1` to start it automatically.

## Endpoint

Live analysis:

```http
POST /api/analyze
Content-Type: application/json

{"url":"https://example.nl"}
```

Fixture analysis:

```http
POST /api/analyze
Content-Type: application/json

{"mode":"fixture"}
```

## Validation

```bash
npm run typecheck
npm test
npm run build
```

The current automated tests cover the stable three-finding JSON contract, the three-page evidence threshold, representative-page diversity, trust detection, competitor scoring parity, entity resolution, competitor-failure isolation and service/ecommerce journey construction. Live Firecrawl/OpenRouter calls and browser interactions are not part of the automated test suite.
