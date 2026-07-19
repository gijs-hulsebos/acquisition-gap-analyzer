# Acquisition Gap Analyzer

A small MVP that analyzes one public website and returns three acquisition findings.

## Flow

1. The user submits a URL.
2. One bounded Firecrawl job reads up to eight pages on that domain.
3. Deterministic extraction builds evidence for the landing-page offer, CTAs and customer journey.
4. OpenRouter optionally rewrites the finished findings in concise language without changing scores or evidence.
5. The dashboard shows the overview, three findings and crawl details.
6. After the main report is complete, the user can request competitor suggestions. The system first resolves the submitted company's industry, offer category, target customer, value-chain role and geography from entity-level public evidence.
7. Public search evidence identifies up to three company names. Their official domains are resolved and candidates are rejected unless their role, core offer, customer type and geography overlap. Consumer retailers cannot be matched to suppliers or wholesalers.
8. The user confirms one suggestion or enters a known competitor URL. That domain starts one three-page Firecrawl job, and the dashboard polls until a side-by-side comparison of the same three findings is ready.

## Findings

- **Offer Clarity** — whether the landing page quickly communicates what the website offers.
- **CTA Clarity** — whether the commercial calls to action are specific and consistent.
- **Customer Journey Path** — estimated clicks from the landing page to checkout, starting with an empty cart. For non-ecommerce websites it estimates the path to the primary conversion interface.

The analyzer reads public HTML, Markdown and links. It does not click buttons, add products, submit forms or complete checkout. Post-click cart and checkout states may therefore be inferred and are labelled in the evidence.

Competitor analysis is optional and never delays or changes the original report. Discovery may use multiple public-search lookups, but only the one user-confirmed competitor is crawled. The session-only result is not stored in a database.

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
