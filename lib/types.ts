export type Confidence = "High" | "Medium" | "Low";
export type Severity = "Critical" | "High" | "Medium" | "Low";
export type AnalysisMode = "live" | "fixture";
export type BusinessModel = "Ecommerce" | "Lead generation" | "Appointment or booking" | "Software or subscription" | "Professional services" | "Local service business" | "Marketplace" | "Informational or non-commercial";
export type ConversionType = "Checkout" | "Add to cart" | "Appointment booking" | "Demo request" | "Application" | "Lead form" | "Signup or subscription" | "No clear conversion";
export type JourneyPageType = "Homepage" | "Category" | "Product" | "Service" | "Cart" | "Checkout" | "Booking" | "Application" | "Pricing" | "Conversion" | "Other";

export type JourneyStage = {
  order: number;
  pageType: JourneyPageType;
  title: string;
  url: string;
  action: string;
  ctaText: string | null;
  nextStepVisible: boolean;
  necessary: boolean;
  friction: string | null;
};

export type CustomerJourney = {
  status: "complete" | "incomplete";
  name: string;
  conversionType: ConversionType;
  startUrl: string;
  destinationUrl: string | null;
  clicksToInterface: number | null;
  additionalObservableActions: number | null;
  stages: JourneyStage[];
  shortestRoute: string[];
  alternativeRoute: string[] | null;
  confidence: Confidence;
  limitations: string[];
};

export type JourneyAnalysis = {
  businessModels: BusinessModel[];
  primaryOffer: string;
  primaryConversionType: ConversionType;
  primary: CustomerJourney;
  secondary: CustomerJourney[];
};

export type GapId = "offer-clarity" | "cta-clarity" | "customer-journey-path";

export type ReadinessCategoryId = GapId;

export type Evidence = {
  statement: string;
  pageLabel: string;
  url: string;
};

export type Gap = {
  id: GapId;
  rank: number;
  title: string;
  summary: string;
  severity: Severity;
  /** Deterministic quality score: higher is better. */
  score: number | null;
  confidence: Confidence;
  evidence: Evidence[];
  nextAction: string;
};

export type ReadinessCategory = {
  id: ReadinessCategoryId;
  label: string;
  score: number | null;
  weight: number;
  confidence: Confidence;
  explanation: string;
  evidence: Evidence[];
  recommendation?: string;
};

export type ReadinessCalculation = {
  status: "scored" | "insufficient-data";
  score: number | null;
  assessedWeight: number;
  minimumWeight: number;
  formula: string;
  categories: ReadinessCategory[];
};

export type ReportOverview = {
  score: number | null;
  status: "Strong" | "Mixed" | "Needs attention" | "Insufficient data";
  explanation: string;
  businessModel: BusinessModel;
  primaryConversion: ConversionType;
  estimatedClicks: number | null;
};

export type CrawlStats = {
  pagesCrawled: number;
  internalLinks: number;
  actionsFound: number;
  conversionPathSteps: number | null;
  processingMs: number;
};

export type AnalysisResult = {
  id: string;
  mode: AnalysisMode;
  url: string;
  companyName: string;
  primaryService: string;
  /** Nullable when the crawl does not contain enough evidence for a fair score. */
  score: number | null;
  scoreLabel: string;
  readiness: ReadinessCalculation;
  confidence: Confidence;
  analyzedAt: string;
  summary: string;
  /** Stable, deterministic overview returned by the JSON API. */
  overview: ReportOverview;
  /** Always contains Offer Clarity, CTA Clarity and Customer Journey Path in that order. */
  gaps: Gap[];
  stats: CrawlStats;
  journey: JourneyAnalysis;
  pages: Array<{
    title: string;
    url: string;
    type: JourneyPageType;
    statusCode: number;
  }>;
  llmEnhanced: boolean;
};

export type PublicCompetitor = {
  name: string;
  url: string;
  pagesAnalyzed: number;
  score: number | null;
  estimatedClicks: number | null;
  findings: Gap[];
};

export type CompetitorScanResult = {
  sourceUrl: string;
  searchedAt: string;
  competitor: PublicCompetitor | null;
  note: string;
};

export type CrawlPage = {
  url: string;
  title: string;
  description: string;
  markdown: string;
  html: string;
  links: string[];
  statusCode: number;
};
