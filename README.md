# Acquisition Gap Analyzer

A full-stack MVP for Dutch SMEs. Enter a public company website and the app crawls a bounded set of pages, extracts observable acquisition evidence, scores six deterministic categories, and returns the three highest-priority gaps in a dashboard.

The result is an MVP heuristic based on public website evidence. It is not conversion analytics and does not guarantee commercial performance.

## What is included

- Landing page with URL entry and saved demo mode
- Four-step loading experience
- `POST /api/analyze` endpoint with URL validation and local/private-address blocking
- Firecrawl v2 integration capped at eight pages and two discovery levels
- Extraction of homepage, service/contact pages, CTAs, forms and internal links
- Six-category weighted conversion-readiness score
- Three ranked, evidence-backed priority findings
- Visible trust-signal analysis on important commercial pages
- Lightweight comparison with up to two likely Dutch public-search competitors
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
2. Firecrawl crawls at most eight same-domain pages, up to two discovery levels.
3. The analyzer extracts links, HTML buttons/anchors, forms, headings and visible text.
4. Six deterministic categories are scored.
5. The weighted readiness score and three priority findings are created.
6. Firecrawl Search selects up to two likely Dutch public-search competitors and scrapes one commercial page per domain.
7. Relevant competitor evidence is appended only to findings that already exist.
8. If OpenRouter is configured, it may rewrite the title, summary and action of those findings. Evidence, scores, severity and ranking remain unchanged.

If competitor discovery or OpenRouter fails, the deterministic website report is still returned.

## Scope and limitations

The current MVP:

- Detects HTML forms but does not submit them.
- Detects CTA text in HTML but does not prove that a CTA is visually prominent.
- Detects trust signals on the same important page but does not prove they are positioned beside the CTA or form.
- Analyzes at most eight pages.
- Cannot discover a conversion route that passes through pages outside the bounded crawl.
- Uses HTML/text heuristics rather than real visitor behaviour or conversion analytics.
- Labels competitors as `Likely public search competitors`; it does not confirm that they are direct commercial competitors.

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
