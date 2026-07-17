export type Confidence = "High" | "Medium" | "Low";
export type Severity = "Critical" | "High" | "Medium" | "Low";
export type AnalysisMode = "live" | "fixture";
export type BusinessModel = "Ecommerce" | "Lead generation" | "Appointment or booking" | "Software or subscription" | "Professional services" | "Local service business" | "Marketplace" | "Informational or non-commercial";
export type ConversionType = "Checkout" | "Add to cart" | "Quote request" | "Appointment booking" | "Demo request" | "Application" | "Lead form" | "Contact" | "Signup or subscription" | "No clear conversion";
export type JourneyPageType = "Homepage" | "Category" | "Product" | "Service" | "Cart" | "Checkout" | "Booking" | "Quote" | "Application" | "Contact" | "Pricing" | "Trust" | "Other";

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

export type GapId =
  | "offer-clarity"
  | "cta-clarity"
  | "customer-journey-path"
  | "cta"
  | "service-page"
  | "conversion-path"
  | "form-friction"
  | "message-consistency"
  | "trust-signals";

export type ReadinessCategoryId =
  | "offer-clarity"
  | "customer-journey-path"
  | "cta-clarity"
  | "service-page-coverage"
  | "conversion-path-quality"
  | "form-friction"
  | "message-consistency"
  | "trust-signals";

export type Evidence = {
  statement: string;
  pageLabel: string;
  url: string;
  source?: "website" | "competitor";
};

export type Gap = {
  id: GapId;
  rank: number;
  title: string;
  summary: string;
  severity: Severity;
  /** Deterministic quality score: higher is better. */
  score: number;
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
};

export type ReadinessCalculation = {
  status: "scored" | "insufficient-data";
  score: number | null;
  assessedWeight: number;
  minimumWeight: number;
  formula: string;
  categories: ReadinessCategory[];
};

export type TrustSignalType =
  | "Reviews or ratings"
  | "Testimonials"
  | "Client logos"
  | "Certifications"
  | "Case studies"
  | "Guarantees"
  | "Delivery or returns"
  | "Payment information"
  | "Contact details";

export type CompetitorMetric = {
  label: string;
  value: string;
  evidence: Evidence;
};

export type PublicSearchCompetitor = {
  name: string;
  url: string;
  pageTitle: string;
  label: "Likely public search competitor";
  dedicatedServicePage: boolean;
  ctaClarity: number;
  conversionPathSteps: number | null;
  trustSignals: TrustSignalType[];
  /** The same three deterministic findings used for the analyzed company. */
  findings: Gap[];
  metrics: CompetitorMetric[];
};

export type ReportOverview = {
  score: number;
  status: "Strong" | "Mixed" | "Needs attention";
  explanation: string;
  businessModel: BusinessModel;
  primaryConversion: ConversionType;
  estimatedClicks: number | null;
};

export type CompetitorAnalysis = {
  status: "available" | "not-found" | "skipped";
  label: "Likely public search competitors";
  query: string;
  geography: string;
  targetCustomer: string;
  entity: ResolvedCompanyEntity;
  note: string;
  competitors: PublicSearchCompetitor[];
};

export type ResolvedCompanyEntity = {
  companyName: string;
  domain: string;
  industry: string;
  businessModel: "local-service" | "professional-service" | "retail-ecommerce" | "software-technology" | "manufacturing-wholesale" | "hospitality" | "other";
  offerings: string[];
  geography: string;
  targetCustomer: string;
  confidence: Confidence;
  method: "deterministic" | "openrouter";
};

export type CrawlStats = {
  pagesCrawled: number;
  internalLinks: number;
  ctasFound: number;
  formsFound: number;
  formFields: number;
  servicePages: number;
  trustSignals: number;
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
  market: {
    geography: string;
    targetCustomer: string;
  };
  competitors: CompetitorAnalysis;
  journey: JourneyAnalysis;
  pages: Array<{
    title: string;
    url: string;
    type: "Homepage" | "Service" | "Contact" | "Other";
    statusCode: number;
  }>;
  llmEnhanced: boolean;
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
