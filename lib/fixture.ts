import type { AnalysisResult, CompetitorScanResult } from "./types";

const DILLE_URL = "https://www.dille-kamille.nl";
const SOSTRENE_URL = "https://sostrenegrene.com/nl";

export const DEMO_RESULT: AnalysisResult = {
  id: "demo-dille-kamille-2026",
  mode: "fixture",
  url: DILLE_URL,
  companyName: "Dille & Kamille",
  primaryService: "Home, kitchen and lifestyle products",
  score: 80,
  scoreLabel: "Strong foundation",
  confidence: "High",
  analyzedAt: "2026-07-19T13:37:00.000Z",
  summary: "Representative journey score: 80/100 across the three fixed findings.",
  overview: { score: 80, status: "Strong", explanation: "The score summarizes the same three deterministic journey findings.", businessModel: "Ecommerce", primaryConversion: "Checkout", estimatedClicks: 4 },
  llmEnhanced: false,
  readiness: {
    status: "scored",
    score: 80,
    assessedWeight: 100,
    minimumWeight: 100,
    formula: "Σ(category score × category weight) ÷ 100",
    categories: [
      { id: "offer-clarity", label: "Offer Clarity", score: 95, weight: 35, confidence: "High", explanation: "The landing page clearly presents home, kitchen and lifestyle products.", evidence: [{ statement: "The landing page shows product collections, product cards and prices.", pageLabel: "Dille & Kamille landing page", url: DILLE_URL }], recommendation: "Keep the assortment and category navigation visible together." },
      { id: "cta-clarity", label: "CTA Clarity", score: 45, weight: 30, confidence: "High", explanation: "The landing page emphasizes product discovery rather than a direct purchase action.", evidence: [{ statement: "The prominent landing-page actions include “Ontdek ons assortiment” and “Bekijk alles”.", pageLabel: "Dille & Kamille landing-page CTA", url: DILLE_URL }], recommendation: "Use a more direct shopping CTA beside featured products." },
      { id: "customer-journey-path", label: "Customer Journey Path", score: 95, weight: 35, confidence: "High", explanation: "The shortest representative route from the landing page to checkout takes four clicks.", evidence: [{ statement: "Estimated path: Homepage → Product → Cart → Checkout (4 clicks).", pageLabel: "Dille & Kamille customer journey", url: DILLE_URL }], recommendation: "Keep the direct product route and cart access visible." },
    ],
  },
  stats: { pagesCrawled: 5, internalLinks: 482, actionsFound: 48, conversionPathSteps: 4, processingMs: 0 },
  journey: {
    businessModels: ["Ecommerce"], primaryOffer: "Home, kitchen and lifestyle products", primaryConversionType: "Checkout", secondary: [],
    primary: {
      status: "complete", name: "Landing page to checkout", conversionType: "Checkout", startUrl: DILLE_URL, destinationUrl: `${DILLE_URL}/checkout`, clicksToInterface: 4, additionalObservableActions: null,
      shortestRoute: [DILLE_URL, `${DILLE_URL}/product`, `${DILLE_URL}/cart`, `${DILLE_URL}/checkout`], alternativeRoute: null, confidence: "High", limitations: ["This saved demo does not submit a purchase."],
      stages: [
        { order: 1, pageType: "Homepage", title: "Dille & Kamille", url: DILLE_URL, action: "Open a featured product", ctaText: "Bekijk alles", nextStepVisible: true, necessary: true, friction: null },
        { order: 2, pageType: "Product", title: "Product", url: `${DILLE_URL}/product`, action: "Add the product to the cart", ctaText: "In winkelmandje", nextStepVisible: true, necessary: true, friction: null },
        { order: 3, pageType: "Cart", title: "Winkelmandje", url: `${DILLE_URL}/cart`, action: "Open the cart", ctaText: "Winkelmandje", nextStepVisible: true, necessary: true, friction: null },
        { order: 4, pageType: "Checkout", title: "Afrekenen", url: `${DILLE_URL}/checkout`, action: "Continue to checkout", ctaText: "Afrekenen", nextStepVisible: true, necessary: true, friction: null },
      ],
    },
  },
  pages: [
    { title: "Dille & Kamille", url: DILLE_URL, type: "Homepage", statusCode: 200 },
    { title: "Categorie", url: `${DILLE_URL}/categorie`, type: "Category", statusCode: 200 },
    { title: "Product", url: `${DILLE_URL}/product`, type: "Product", statusCode: 200 },
    { title: "Winkelmandje", url: `${DILLE_URL}/cart`, type: "Cart", statusCode: 200 },
    { title: "Afrekenen", url: `${DILLE_URL}/checkout`, type: "Checkout", statusCode: 200 },
  ],
  gaps: [
    { id: "offer-clarity", rank: 1, title: "Offer Clarity", summary: "The landing page clearly presents home, kitchen and lifestyle products.", severity: "Low", score: 95, confidence: "High", evidence: [{ statement: "The landing page shows product collections, product cards and prices.", pageLabel: "Dille & Kamille landing page", url: DILLE_URL }], nextAction: "Keep the assortment and category navigation visible together." },
    { id: "cta-clarity", rank: 2, title: "CTA Clarity", summary: "The landing page emphasizes product discovery rather than a direct purchase action.", severity: "Medium", score: 45, confidence: "High", evidence: [{ statement: "The prominent landing-page actions include “Ontdek ons assortiment” and “Bekijk alles”.", pageLabel: "Dille & Kamille landing-page CTA", url: DILLE_URL }], nextAction: "Use a more direct shopping CTA beside featured products." },
    { id: "customer-journey-path", rank: 3, title: "Customer Journey Path", summary: "The shortest representative route from the landing page to checkout takes four clicks.", severity: "Low", score: 95, confidence: "High", evidence: [{ statement: "Estimated path: Homepage → Product → Cart → Checkout (4 clicks).", pageLabel: "Dille & Kamille customer journey", url: DILLE_URL }], nextAction: "Keep the direct product route and cart access visible." },
  ],
};

export const DEMO_COMPETITOR_RESULT: CompetitorScanResult = {
  sourceUrl: DILLE_URL,
  searchedAt: "2026-07-19T13:37:00.000Z",
  note: "Saved comparison data · no live scan required.",
  competitor: {
    name: "Søstrene Grene",
    url: SOSTRENE_URL,
    pagesAnalyzed: 5,
    score: 97,
    estimatedClicks: 3,
    findings: [
      { id: "offer-clarity", rank: 1, title: "Offer Clarity", summary: "The landing page clearly presents products, collections and prices.", severity: "Low", score: 95, confidence: "High", evidence: [{ statement: "The landing page shows themed collections, product cards, product names and prices.", pageLabel: "Søstrene Grene landing page", url: SOSTRENE_URL }], nextAction: "Keep representative collections and products visible together." },
      { id: "cta-clarity", rank: 2, title: "CTA Clarity", summary: "Product cards expose a direct Add to cart action on the landing page.", severity: "Low", score: 100, confidence: "High", evidence: [{ statement: "Visible product cards include direct cart controls, allowing purchase intent from the landing page.", pageLabel: "Søstrene Grene landing-page CTA", url: SOSTRENE_URL }], nextAction: "Keep Add to cart controls clear and consistently labelled." },
      { id: "customer-journey-path", rank: 3, title: "Customer Journey Path", summary: "A landing-page product can reach checkout in an estimated three clicks.", severity: "Low", score: 95, confidence: "High", evidence: [{ statement: "Estimated path: Add to cart on Homepage → Cart → Checkout (3 clicks).", pageLabel: "Søstrene Grene customer journey", url: SOSTRENE_URL }], nextAction: "Keep the direct landing-page purchase route visible." },
    ],
  },
};
