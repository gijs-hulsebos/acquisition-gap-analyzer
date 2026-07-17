import type { AnalysisResult } from "./types";

export const DEMO_RESULT: AnalysisResult = {
  id: "demo-home-store-2026",
  mode: "fixture",
  url: "https://atelier-home.example",
  companyName: "Atelier Home",
  primaryService: "Online assortment: Kitchen, Cast-iron pan",
  score: 91,
  scoreLabel: "Strong foundation",
  confidence: "High",
  analyzedAt: "2026-07-17T09:42:00.000Z",
  summary: "Representative journey score: 91/100 across the three fixed findings.",
  overview: { score: 91, status: "Strong", explanation: "The score summarizes the same three deterministic journey findings.", businessModel: "Ecommerce", primaryConversion: "Checkout", estimatedClicks: 5 },
  llmEnhanced: false,
  readiness: {
    status: "scored",
    score: 91,
    assessedWeight: 100,
    minimumWeight: 100,
    formula: "Σ(category score × category weight) ÷ 100",
    categories: [
      { id: "offer-clarity", label: "Offer Clarity", score: 95, weight: 35, confidence: "High", explanation: "The landing page makes it clear that visitors can browse and buy products.", evidence: [{ statement: "Categories, products, prices and an assortment action are visible on the landing page.", pageLabel: "Landing-page offer", url: "https://atelier-home.example/" }], recommendation: "Keep the assortment and shopping action visible together." },
      { id: "cta-clarity", label: "CTA Clarity", score: 100, weight: 30, confidence: "High", explanation: "The next shopping actions are clear: Shop kitchen → Cast-iron pan → Add to cart.", evidence: [{ statement: "Product discovery, selection and Add to cart are explicit.", pageLabel: "Representative journey", url: "https://atelier-home.example/products/pan" }], recommendation: "Keep the discovery and Add to cart labels consistent." },
      { id: "customer-journey-path", label: "Customer Journey Path", score: 80, weight: 35, confidence: "High", explanation: "The verified Add to cart path takes four steps.", evidence: [{ statement: "Homepage → category → product → Add to cart.", pageLabel: "Verified journey", url: "https://atelier-home.example/products/pan" }], recommendation: "Keep the shortest verified path visible." },
    ],
  },
  stats: { pagesCrawled: 3, internalLinks: 18, actionsFound: 14, conversionPathSteps: 4, processingMs: 4120 },
  journey: {
    businessModels: ["Ecommerce"], primaryOffer: "Online assortment: Kitchen, Cast-iron pan", primaryConversionType: "Checkout", secondary: [],
    primary: {
      status: "complete", name: "Landing page to checkout", conversionType: "Checkout", startUrl: "https://atelier-home.example/", destinationUrl: "https://atelier-home.example/checkout", clicksToInterface: 5, additionalObservableActions: null,
      shortestRoute: ["https://atelier-home.example/", "https://atelier-home.example/kitchen", "https://atelier-home.example/products/pan"], alternativeRoute: null, confidence: "High", limitations: ["No purchase or payment was completed."],
      stages: [
        { order: 1, pageType: "Homepage", title: "Atelier Home", url: "https://atelier-home.example/", action: "Click “Shop kitchen”", ctaText: "Shop kitchen", nextStepVisible: true, necessary: true, friction: null },
        { order: 2, pageType: "Category", title: "Kitchen", url: "https://atelier-home.example/kitchen", action: "Click “Cast-iron pan”", ctaText: "Cast-iron pan", nextStepVisible: true, necessary: true, friction: null },
        { order: 3, pageType: "Product", title: "Cast-iron pan", url: "https://atelier-home.example/products/pan", action: "Click “Add to cart”", ctaText: "Add to cart", nextStepVisible: true, necessary: true, friction: null },
        { order: 4, pageType: "Cart", title: "Cart", url: "https://atelier-home.example/cart", action: "Open cart", ctaText: null, nextStepVisible: true, necessary: true, friction: null },
        { order: 5, pageType: "Checkout", title: "Checkout", url: "https://atelier-home.example/checkout", action: "Continue to checkout", ctaText: null, nextStepVisible: true, necessary: true, friction: null },
      ],
    },
  },
  pages: [
    { title: "Atelier Home", url: "https://atelier-home.example/", type: "Homepage", statusCode: 200 },
    { title: "Kitchen", url: "https://atelier-home.example/kitchen", type: "Category", statusCode: 200 },
    { title: "Cast-iron pan", url: "https://atelier-home.example/products/pan", type: "Product", statusCode: 200 },
  ],
  gaps: [
    { id: "offer-clarity", rank: 1, title: "Offer Clarity", summary: "The landing page makes it clear that visitors can browse and buy products.", severity: "Low", score: 95, confidence: "High", evidence: [{ statement: "Categories, products, prices and an assortment action are visible on the landing page.", pageLabel: "Landing-page offer", url: "https://atelier-home.example/" }], nextAction: "Keep the assortment and shopping action visible together." },
    { id: "cta-clarity", rank: 2, title: "CTA Clarity", summary: "The next shopping actions are clear: Shop kitchen → Cast-iron pan → Add to cart.", severity: "Low", score: 100, confidence: "High", evidence: [{ statement: "Product discovery, selection and Add to cart are explicit.", pageLabel: "Representative journey", url: "https://atelier-home.example/products/pan" }], nextAction: "Keep the discovery and Add to cart labels consistent." },
    { id: "customer-journey-path", rank: 3, title: "Customer Journey Path", summary: "The verified Add to cart path takes four steps.", severity: "Low", score: 80, confidence: "High", evidence: [{ statement: "Homepage → category → product → Add to cart.", pageLabel: "Verified journey", url: "https://atelier-home.example/products/pan" }], nextAction: "Keep the shortest verified path visible." },
  ],
};
