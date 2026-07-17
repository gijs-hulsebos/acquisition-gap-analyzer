export type Confidence = "High" | "Medium" | "Low";
export type Severity = "Critical" | "High" | "Medium" | "Low";
export type AnalysisMode = "live" | "fixture";

export type GapId =
  | "cta"
  | "service-page"
  | "conversion-path"
  | "form-friction"
  | "message-consistency"
  | "trust-signals";

export type ReadinessCategoryId =
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
  /** Impact score: higher means a more important gap. */
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
  metrics: CompetitorMetric[];
};

export type CompetitorAnalysis = {
  status: "available" | "not-found" | "skipped";
  label: "Likely public search competitors";
  query: string;
  geography: string;
  targetCustomer: string;
  note: string;
  competitors: PublicSearchCompetitor[];
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
  gaps: Gap[];
  stats: CrawlStats;
  market: {
    geography: string;
    targetCustomer: string;
  };
  competitors: CompetitorAnalysis;
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
