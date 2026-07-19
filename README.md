# Acquisition Gap Analyzer

A small MVP that analyzes one public website and returns three acquisition findings.

## Flow

1. The user submits a URL.
2. One bounded Firecrawl job reads up to eight pages on that domain.
3. Deterministic extraction builds evidence for the landing-page offer, purchase confidence and customer journey.
4. OpenRouter optionally rewrites the finished findings and creates a concise improvement report without changing scores or evidence.
5. The dashboard shows the overview, three findings, improvement report and crawl details.
6. After the main report is complete, the user can optionally enter a competitor URL. The same analysis endpoint scans it, compares the deterministic results and adds a competitor section to the improvement report.

## Findings

- **Offer Clarity** — whether the landing page quickly communicates what the website offers.
- **Purchase Confidence** — visible pricing, delivery, returns, ratings, payment reassurance, support, guarantees and availability.
- **Customer Journey Path** — estimated clicks from the landing page to checkout, starting with an empty cart. For non-ecommerce websites it estimates the path to the primary conversion interface.

The analyzer reads public HTML, Markdown and links. It does not click buttons, add products, submit forms or complete checkout. Post-click cart and checkout states may therefore be inferred and are labelled in the evidence.

Competitor analysis is optional and never delays or changes the original report. It uses the same bounded analysis mechanism as the company scan, and its session-only result is not stored in a database. The saved demo comparison uses fixture data and performs no live crawl.

## Improvement report

The improvement report contains:

- what the company already does well;
- what could be improved;
- what the competitor does differently, only after a competitor scan.

OpenRouter receives a compact JSON payload containing only the deterministic scores, findings, evidence and recommended actions. It may improve the wording, but it cannot alter the underlying scores or evidence. When OpenRouter is unavailable, the app shows a deterministic evidence summary instead.

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
