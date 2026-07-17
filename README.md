# Acquisition Gap Analyzer

A full-stack MVP for Dutch SMEs. Enter a public company website and the app selects a bounded set of representative commercial pages, maps a conversion journey, and returns three deterministic evidence-backed findings.

The result is an MVP heuristic based on public website evidence. It is not conversion analytics and does not guarantee commercial performance.

## What is included

- Landing page with URL entry and saved demo mode
- Four-step loading experience
- `POST /api/analyze` endpoint with URL validation and local/private-address blocking
- Homepage-first business classification followed by up to eight representative same-domain pages
- Extraction of representative first-party pages, actions, forms and internal links
- Three-metric weighted conversion-readiness overview
- Structured primary customer journey with every required user action and an explicit complete/incomplete status
- Exactly three evidence-backed findings: Offer Clarity, CTA Clarity and Customer Journey Path
- Entity-first comparison with up to two matching Dutch public-search competitors, each checked across representative pages
- Optional OpenRouter report-copy rewrite; it cannot generate, score, rank or rename findings
- Responsive dark dashboard with expandable evidence and crawl details

## Analysis categories

| Category | Weight | What is measured |
| --- | ---: | --- |
| Offer Clarity | 35% | Whether a new visitor can identify what is sold, who it is for and why they should choose it from headings, supporting copy and representative offer pages |
| CTA Clarity | 30% | Whether the representative journey exposes explicit, linked actions; ecommerce checks discovery, selection, Add to cart, Cart and Checkout |
| Customer Journey Path | 35% | A fully evidenced route from arrival to the primary conversion interface, including state-changing actions such as add to cart |

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
4. A model-specific representative-page plan is loaded. Ecommerce selects one linked category/search page, one linked product, cart and checkout. Other models select representative offer, pricing and conversion pages.
5. Firecrawl Map is used only as a same-domain lookup for those representative roles.
6. At most one representative product page is retained, preventing a product catalogue from crowding out journey evidence. Up to eight useful pages are returned.
7. Ecommerce verifies one complete route: homepage → category/search → product → add to cart → cart → checkout. Every link or button must be present, a directly requested empty cart is never treated as converted state, and missing proof produces `Incomplete journey`.
8. The deterministic layer scores Offer Clarity, CTA Clarity and Customer Journey Path and emits the stable JSON report contract.
9. The company entity is resolved from first-party evidence into business type, primary offer, geography and target customer.
10. Firecrawl Search uses that resolved market profile instead of raw keywords. Same-company regional sites, directories, editorial/review results, incompatible industries, different country/local markets and unrelated offers are rejected before crawling.
11. Only the top two accepted competitor domains are crawled. Any accepted domain later rejected by crawled evidence is retained in the report with its rejection reason.
12. Accepted competitors receive the exact same Offer Clarity, CTA Clarity and Customer Journey Path checks as the submitted company. OpenRouter cannot replace the deterministic offer conclusion or an incomplete journey finding.

If competitor discovery or OpenRouter fails, the deterministic website report is still returned.

## Scope and limitations

The current MVP:

- Detects HTML forms but does not submit them.
- Detects CTA text in HTML but does not prove that a CTA is visually prominent.
- Analyzes at most eight representative journey pages after mapping the domain.
- Cannot confirm a conversion route that passes through pages outside the selected page set.
- Never places an order, creates an account, books an appointment or submits a form.
- Because no product is actually added, ecommerce checkout is only marked complete when public HTML exposes every required action and a non-empty representative cart state; otherwise the result is explicitly incomplete.
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

The current automated tests cover the stable three-finding JSON contract, the three-page evidence threshold, business-model separation, empty-cart journey rules, representative-page diversity, competitor scoring parity, entity resolution, competitor audit reasons and failure isolation. Live Firecrawl/OpenRouter calls and browser interactions are not part of the automated test suite.
