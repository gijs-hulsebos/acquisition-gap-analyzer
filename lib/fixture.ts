import type { AnalysisResult, Evidence, Gap } from "./types";

const competitorEvidence = (statement: string, url: string): Evidence => ({ statement, pageLabel: "Representative competitor journey", url, source: "competitor" });

const competitorFindings: Gap[] = [
  { id: "offer-clarity", rank: 1, title: "Offer Clarity", summary: "The assortment, audience and practical value are explicit.", severity: "Low", score: 92, confidence: "High", evidence: [competitorEvidence("Homepage, category and product copy consistently describe home and kitchen products for consumers.", "https://rival-home.example/")], nextAction: "Keep the offer framing consistent." },
  { id: "cta-clarity", rank: 2, title: "CTA Clarity", summary: "All five purchase actions are explicit and linked.", severity: "Low", score: 100, confidence: "High", evidence: [competitorEvidence("Discovery, selection, Add to cart, Cart and Checkout controls are present.", "https://rival-home.example/products/pan")], nextAction: "Keep purchase actions consistent." },
  { id: "customer-journey-path", rank: 3, title: "Customer Journey Path", summary: "The complete checkout journey is verified in four actions.", severity: "Low", score: 90, confidence: "High", evidence: [competitorEvidence("Homepage → category → product → Add to cart → cart → checkout.", "https://rival-home.example/checkout")], nextAction: "Keep the verified route available." },
];

export const DEMO_RESULT: AnalysisResult = {
  id: "demo-home-store-2026",
  mode: "fixture",
  url: "https://atelier-home.example",
  companyName: "Atelier Home",
  primaryService: "Online assortment: Kitchen, Cast-iron pan",
  score: 69,
  scoreLabel: "Nearly conversion-ready",
  confidence: "High",
  analyzedAt: "2026-07-17T09:42:00.000Z",
  summary: "Representative journey score: 69/100 across the three fixed findings.",
  overview: { score: 69, status: "Mixed", explanation: "The score summarizes the same three deterministic journey findings.", businessModel: "Ecommerce", primaryConversion: "Checkout", estimatedClicks: 5 },
  llmEnhanced: false,
  readiness: {
    status: "scored",
    score: 69,
    assessedWeight: 100,
    minimumWeight: 100,
    formula: "Σ(category score × category weight) ÷ 100",
    categories: [
      { id: "offer-clarity", label: "Offer Clarity", score: 75, weight: 35, confidence: "High", explanation: "The products and audience are clear, but the relevance could be more specific.", evidence: [{ statement: "Homepage, category and product copy identify kitchen products for consumers.", pageLabel: "What is sold", url: "https://atelier-home.example/" }], recommendation: "Add one concrete reason to choose this assortment." },
      { id: "cta-clarity", label: "CTA Clarity", score: 80, weight: 30, confidence: "High", explanation: "Four of five purchase actions are explicit and linked.", evidence: [{ statement: "Product discovery, selection, Add to cart and Checkout are explicit; Cart is less prominent.", pageLabel: "Representative journey", url: "https://atelier-home.example/products/pan" }], recommendation: "Make the Cart action explicit after adding a product." },
      { id: "customer-journey-path", label: "Customer Journey Path", score: 50, weight: 35, confidence: "High", explanation: "The checkout route requires five user actions.", evidence: [{ statement: "Homepage → category → product → Add to cart → open Cart → Checkout.", pageLabel: "Verified journey", url: "https://atelier-home.example/checkout" }], recommendation: "Open the cart directly after Add to cart." },
    ],
  },
  stats: { pagesCrawled: 5, internalLinks: 18, actionsFound: 14, conversionPathSteps: 5, processingMs: 4120 },
  market: { geography: "Nederland", targetCustomer: "particulieren" },
  competitors: {
    status: "available",
    label: "Likely public search competitors",
    query: "home and kitchen products consumers Netherlands",
    geography: "Nederland",
    targetCustomer: "particulieren",
    entity: { companyName: "Atelier Home", domain: "atelier-home.example", industry: "Home and lifestyle retail", businessModel: "retail-ecommerce", offerings: ["kitchen products", "home accessories"], geography: "Nederland", targetCustomer: "particulieren", confidence: "High", method: "deterministic" },
    note: "One validated direct competitor was analyzed with the identical three-category method.",
    competitors: [{ name: "Rival Home", url: "https://rival-home.example", pageTitle: "Rival Home", label: "Likely public search competitor", pagesAnalyzed: 5, dataStatus: "scored", findings: competitorFindings }],
    rejected: [{ name: "Home shop reviews", url: "https://reviews.example/home-shops", reason: "Directory, blog, review site or other non-commercial result.", crawled: false }],
  },
  journey: {
    businessModels: ["Ecommerce"], primaryOffer: "Online assortment: Kitchen, Cast-iron pan", primaryConversionType: "Checkout", secondary: [],
    primary: {
      status: "complete", name: "Checkout journey", conversionType: "Checkout", startUrl: "https://atelier-home.example/", destinationUrl: "https://atelier-home.example/checkout", clicksToInterface: 5, additionalObservableActions: null,
      shortestRoute: ["https://atelier-home.example/", "https://atelier-home.example/kitchen", "https://atelier-home.example/products/pan", "https://atelier-home.example/cart", "https://atelier-home.example/checkout"], alternativeRoute: null, confidence: "High", limitations: ["No purchase or payment was completed."],
      stages: [
        { order: 1, pageType: "Homepage", title: "Atelier Home", url: "https://atelier-home.example/", action: "Click “Shop kitchen”", ctaText: "Shop kitchen", nextStepVisible: true, necessary: true, friction: null },
        { order: 2, pageType: "Category", title: "Kitchen", url: "https://atelier-home.example/kitchen", action: "Click “Cast-iron pan”", ctaText: "Cast-iron pan", nextStepVisible: true, necessary: true, friction: null },
        { order: 3, pageType: "Product", title: "Cast-iron pan", url: "https://atelier-home.example/products/pan", action: "Click “Add to cart”", ctaText: "Add to cart", nextStepVisible: true, necessary: true, friction: null },
        { order: 4, pageType: "Cart", title: "Cart", url: "https://atelier-home.example/cart", action: "Click “Checkout”", ctaText: "Checkout", nextStepVisible: true, necessary: true, friction: null },
        { order: 5, pageType: "Checkout", title: "Checkout", url: "https://atelier-home.example/checkout", action: "Reach checkout", ctaText: null, nextStepVisible: true, necessary: true, friction: null },
      ],
    },
  },
  pages: [
    { title: "Atelier Home", url: "https://atelier-home.example/", type: "Homepage", statusCode: 200 },
    { title: "Kitchen", url: "https://atelier-home.example/kitchen", type: "Category", statusCode: 200 },
    { title: "Cast-iron pan", url: "https://atelier-home.example/products/pan", type: "Product", statusCode: 200 },
    { title: "Cart", url: "https://atelier-home.example/cart", type: "Cart", statusCode: 200 },
    { title: "Checkout", url: "https://atelier-home.example/checkout", type: "Checkout", statusCode: 200 },
  ],
  gaps: [
    { id: "offer-clarity", rank: 1, title: "Offer Clarity", summary: "The products and audience are clear, but the relevance could be more specific.", severity: "Medium", score: 75, confidence: "High", evidence: [{ statement: "Homepage, category and product copy identify kitchen products for consumers.", pageLabel: "What is sold", url: "https://atelier-home.example/" }], nextAction: "Add one concrete reason to choose this assortment." },
    { id: "cta-clarity", rank: 2, title: "CTA Clarity", summary: "Four of five purchase actions are explicit and linked.", severity: "Low", score: 80, confidence: "High", evidence: [{ statement: "Product discovery, selection, Add to cart and Checkout are explicit; Cart is less prominent.", pageLabel: "Representative journey", url: "https://atelier-home.example/products/pan" }], nextAction: "Make the Cart action explicit after adding a product." },
    { id: "customer-journey-path", rank: 3, title: "Customer Journey Path", summary: "The checkout route requires five user actions.", severity: "Medium", score: 50, confidence: "High", evidence: [{ statement: "Homepage → category → product → Add to cart → open Cart → Checkout.", pageLabel: "Verified journey", url: "https://atelier-home.example/checkout" }], nextAction: "Open the cart directly after Add to cart." },
  ],
};
