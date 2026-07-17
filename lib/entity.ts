import type { AnalysisResult, CrawlPage, ResolvedCompanyEntity } from "./types";

export type SearchCandidate = {
  title?: string;
  description?: string;
  url: string;
};

const INDUSTRIES: Array<{ industry: string; pattern: RegExp }> = [
  { industry: "Home and lifestyle retail", pattern: /\b(woonaccessoires|tafelen|keukenaccessoires|cadeauwinkel|huishoudartikelen|interieurwinkel|homeware|lifestyle winkel|webshop|winkelmand)\b/i },
  { industry: "HVAC and climate installation", pattern: /\b(warmtepomp|airco|klimaattechniek|cv[- ]?ketel|verwarming|ventilatie|installatietechniek)\b/i },
  { industry: "Fire safety services", pattern: /\b(brandveilig|brandbeveilig|brandmeld|blusmiddelen|sprinkler|brandpreventie)\b/i },
  { industry: "Construction and renovation", pattern: /\b(aannemer|bouwbedrijf|renovatie|verbouwing|nieuwbouw|dakwerk|timmerwerk)\b/i },
  { industry: "Marketing and creative services", pattern: /\b(marketingbureau|seo|advertising|branding|webdesign|contentmarketing|social media bureau)\b/i },
  { industry: "Accounting and financial services", pattern: /\b(accountant|boekhoud|belastingadvies|administratiekantoor|financial advisory)\b/i },
  { industry: "Legal services", pattern: /\b(advocaat|juridisch advies|notaris|rechtsbijstand|law firm)\b/i },
  { industry: "Healthcare services", pattern: /\b(fysiotherap|tandarts|huisarts|zorgpraktijk|kliniek|therapie|medical clinic)\b/i },
  { industry: "Software and technology", pattern: /\b(saas|softwareplatform|softwarebedrijf|cloud oplossing|it-dienst|cybersecurity|app development)\b/i },
  { industry: "Hospitality", pattern: /\b(hotel|restaurant|brasserie|catering|vakantiepark|bed and breakfast)\b/i },
  { industry: "Automotive services", pattern: /\b(autogarage|autoservice|autodealer|occasion|car repair|bandenservice)\b/i },
  { industry: "Real estate services", pattern: /\b(makelaar|vastgoed|woningverkoop|property management|real estate)\b/i },
  { industry: "Logistics and transport", pattern: /\b(logistiek|transportbedrijf|koeriersdienst|fulfilment|warehousing)\b/i },
  { industry: "Manufacturing and wholesale", pattern: /\b(fabrikant|producent|groothandel|manufacturing|wholesale|leverancier voor bedrijven)\b/i },
];

const TOKEN_STOP_WORDS = new Set([
  "and", "the", "voor", "van", "met", "een", "het", "company", "services", "service",
  "nederland", "nederlandse", "bedrijf", "bedrijven", "klanten", "customer", "customers",
  "retail", "local", "professional", "other", "website", "official", "home",
]);

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function semanticTokens(value: string) {
  return Array.from(new Set(
    value
      .toLowerCase()
      .replace(/[^a-zà-ÿ0-9\s-]/g, " ")
      .split(/[\s-]+/)
      .filter((token) => token.length >= 4 && !TOKEN_STOP_WORDS.has(token)),
  ));
}

function pageEvidence(pages: CrawlPage[]) {
  return pages.slice(0, 8).map((page) => compact(`${page.title}. ${page.description}. ${page.markdown.slice(0, 900)}`)).join("\n").slice(0, 7000);
}

function inferBusinessModel(text: string): ResolvedCompanyEntity["businessModel"] {
  if (/\b(webshop|winkelmand|producten|collectie|shop online|bestellen|voorraad|filialen|winkels)\b/i.test(text)) return "retail-ecommerce";
  if (/\b(saas|software|platform|cloud|abonnement)\b/i.test(text)) return "software-technology";
  if (/\b(fabrikant|producent|groothandel|distributeur|dealer netwerk)\b/i.test(text)) return "manufacturing-wholesale";
  if (/\b(hotel|restaurant|catering|vakantie|overnachting)\b/i.test(text)) return "hospitality";
  if (/\b(adviseur|consultancy|accountant|advocaat|marketingbureau|bureau)\b/i.test(text)) return "professional-service";
  if (/\b(offerte|afspraak|installatie|onderhoud|reparatie|werkgebied|service aan huis)\b/i.test(text)) return "local-service";
  return "other";
}

function fallbackIndustry(text: string, primaryService: string) {
  return INDUSTRIES.find((item) => item.pattern.test(text))?.industry || compact(primaryService).slice(0, 90) || "Other business services";
}

function offeringCandidates(result: AnalysisResult, pages: CrawlPage[]) {
  const values = [
    result.primaryService,
    ...pages.filter((page) => page.url !== result.url).slice(0, 5).map((page) => page.title.split(/\s+[|—–-]\s+/)[0]),
  ]
    .map(compact)
    .filter((value) => value.length >= 4 && value.length <= 100)
    .filter((value) => !/^home(page)?$/i.test(value));
  return Array.from(new Set(values)).slice(0, 5);
}

export function buildDeterministicEntityProfile(result: AnalysisResult, pages: CrawlPage[]): ResolvedCompanyEntity {
  const evidence = pageEvidence(pages);
  const combined = `${result.companyName}\n${result.primaryService}\n${evidence}`;
  return {
    companyName: result.companyName,
    domain: new URL(result.url).hostname.replace(/^www\./, ""),
    industry: fallbackIndustry(combined, result.primaryService),
    businessModel: inferBusinessModel(combined),
    offerings: offeringCandidates(result, pages),
    geography: result.market.geography,
    targetCustomer: result.market.targetCustomer,
    confidence: pages.length >= 4 ? "High" : pages.length >= 2 ? "Medium" : "Low",
    method: "deterministic",
  };
}

export async function resolveCompanyEntity(
  result: AnalysisResult,
  pages: CrawlPage[],
  apiKey: string | undefined,
): Promise<ResolvedCompanyEntity> {
  const fallback = buildDeterministicEntityProfile(result, pages);
  if (!apiKey) return fallback;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
        "X-OpenRouter-Title": "Acquisition Gap Analyzer",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini",
        temperature: 0,
        max_completion_tokens: 450,
        messages: [
          {
            role: "system",
            content: "Resolve the company entity from first-party website evidence. Infer its stable industry and business model before competitor search. Do not use a single product phrase as the industry. A competitor must sell substantially similar products or services to the same customer type. Return only supported, concise values.",
          },
          {
            role: "user",
            content: JSON.stringify({
              claimedIdentity: { companyName: result.companyName, domain: fallback.domain },
              existingInference: fallback,
              firstPartyEvidence: pageEvidence(pages),
            }),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "resolved_company_entity",
            strict: true,
            schema: {
              type: "object",
              properties: {
                companyName: { type: "string" },
                industry: { type: "string" },
                businessModel: { type: "string", enum: ["local-service", "professional-service", "retail-ecommerce", "software-technology", "manufacturing-wholesale", "hospitality", "other"] },
                offerings: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } },
                geography: { type: "string" },
                targetCustomer: { type: "string" },
              },
              required: ["companyName", "industry", "businessModel", "offerings", "geography", "targetCustomer"],
              additionalProperties: false,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok) return fallback;
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;
    if (!content) return fallback;
    const resolved = JSON.parse(content) as Omit<ResolvedCompanyEntity, "domain" | "confidence" | "method">;
    if (!resolved.industry?.trim() || !resolved.offerings?.length) return fallback;
    return {
      ...fallback,
      ...resolved,
      companyName: resolved.companyName.trim() || fallback.companyName,
      domain: fallback.domain,
      industry: compact(resolved.industry).slice(0, 100),
      offerings: resolved.offerings.map(compact).filter(Boolean).slice(0, 5),
      geography: compact(resolved.geography) || fallback.geography,
      targetCustomer: compact(resolved.targetCustomer) || fallback.targetCustomer,
      confidence: "High",
      method: "openrouter",
    };
  } catch {
    return fallback;
  }
}

export function buildCompetitorSearchQuery(entity: ResolvedCompanyEntity) {
  const model = entity.businessModel === "retail-ecommerce" ? "winkels webshop" : entity.businessModel === "local-service" ? "bedrijven specialist" : "bedrijven";
  const offering = entity.offerings.slice(0, 2).join(" ");
  return compact(`\"${entity.industry}\" ${offering} ${entity.geography} ${entity.targetCustomer} ${model}`);
}

export function competitorCandidateScore(entity: ResolvedCompanyEntity, candidate: SearchCandidate) {
  const haystack = `${candidate.title || ""} ${candidate.description || ""} ${candidate.url}`.toLowerCase();
  const industryTokens = semanticTokens(entity.industry);
  const offeringTokens = semanticTokens(entity.offerings.join(" "));
  const industryMatches = industryTokens.filter((token) => haystack.includes(token)).length;
  const offeringMatches = offeringTokens.filter((token) => haystack.includes(token)).length;
  const geographyMatches = semanticTokens(entity.geography).filter((token) => haystack.includes(token)).length;
  const modelMatch = entity.businessModel === "retail-ecommerce"
    ? /\b(webshop|winkel|collectie|producten|shop)\b/i.test(haystack)
    : entity.businessModel === "local-service"
      ? /\b(offerte|advies|installatie|onderhoud|specialist|service)\b/i.test(haystack)
      : true;
  const path = new URL(candidate.url).pathname;
  const commercialPath = path !== "/" && /\/(diensten?|services?|oplossingen?|producten?|collectie|aanbod|offerte|shop)\b/i.test(path);
  const semanticMatch = industryMatches >= 1 || offeringMatches >= 2;
  if (!semanticMatch || !modelMatch) return -100;
  return industryMatches * 5 + offeringMatches * 3 + geographyMatches * 2 + (commercialPath ? 3 : 0);
}
