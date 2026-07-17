# Acquisition Gap Analyzer

A full-stack MVP for Dutch SMEs. Enter a public company website and the app crawls a bounded set of pages, extracts observable acquisition evidence, scores six deterministic categories, and returns the three highest-priority gaps in a dashboard.

The result is an MVP heuristic based on public website evidence. It is not conversion analytics and does not guarantee commercial performance.

## What is included

- Landing page with URL entry and saved demo mode
- Four-step loading experience
- `POST /api/analyze` endpoint with URL validation and local/private-address blocking
- Firecrawl v2 domain mapping followed by targeted scraping of up to eight representative journey pages
- Extraction of homepage, service/contact pages, CTAs, forms and internal links
- Six-category weighted conversion-readiness score
- Structured primary customer journey with required clicks, additional observable actions and ordered stages
- Three ranked, evidence-backed priority findings
- Visible trust-signal analysis on important commercial pages
- Entity-first comparison with up to two likely Dutch public-search competitors
- Optional OpenRouter rewrite of deterministic finding copy
- Responsive dark dashboard with expandable evidence and crawl details

## Analysis categories

| Category | Weight | What is measured |
| --- | ---: | --- |
| CTA clarity | 20% | Specific versus generic homepage calls to action |
| Service-page coverage | 20% | Number of dedicated service-specific pages found |
| Conversion-path quality | 20% | Shortest crawled route from the homepage to a form/contact destination |
| Form friction | 15% | Visible form-field and required-field count |
| Message consistency | 10% | Repetition of the primary-service language across key headings and descriptions |
| Trust signals | 15% | Reviews, testimonials, logos, certifications, cases, guarantees and contact details on important pages |

The score is calculated as:

```text
sum(category score x category weight) / sum(assessed category weights)
```

A score is shown only when at least two readable pages, 80% assessed weight, and all three core categories (CTA, service pages and conversion path) are available. Otherwise the report shows `Insufficient data`. Confidence is calculated separately.

Every scored category becomes a potential finding with impact `100 - category score`. The three largest impacts are ranked and returned. Competitor evidence can strengthen one of those existing findings but cannot create a new finding or change the readiness score.

## Live-analysis flow

1. The server validates and normalizes the submitted URL.
2. Firecrawl Map discovers the submitted domain structure without scraping the catalogue.
3. The selector chooses at most one representative homepage, category, product, service, cart, checkout/form, pricing and trust page.
4. Firecrawl scrapes only those selected same-domain pages; the former bounded crawl is used only as a fallback if mapping fails.
5. The analyzer infers one or more business models and selects the most important visible commercial conversion.
6. A graph of selected internal pages, links and observable cart/checkout actions is used to find the shortest realistic route from homepage to conversion interface.
7. Six deterministic categories are scored and the three highest-impact evidence-backed gaps are ranked.
8. The company entity is resolved from first-party evidence before the separate competitor phase.
9. Firecrawl Search uses that resolved market profile instead of a raw page keyword, and rejects candidates without sufficient industry and offering overlap.
10. Up to two matching domains are selected and one commercial page per domain is scraped and validated again.
11. If OpenRouter is configured, it may rewrite finding copy. Evidence, scores, severity and ranking remain unchanged.

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

The current automated tests cover weighted scoring, insufficient-data behavior, form friction, trust detection and the rule that competitor evidence may only strengthen existing findings. Live Firecrawl/OpenRouter calls and browser interactions are not part of the automated test suite.
