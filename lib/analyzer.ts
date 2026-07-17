import type {
  AnalysisResult,
  Confidence,
  ConversionType,
  CrawlPage,
  Evidence,
  Gap,
  GapId,
  JourneyAnalysis,
  JourneyPageType,
  JourneyStage,
  ReadinessCategory,
  Severity,
  TrustSignalType,
} from "./types";
import { normalizePageUrl } from "./url";
import { classifyCommercialModel, publicBusinessModels } from "./journey-model";
import type { CommercialModel } from "./journey-model";

type Clickable = { text: string; href: string | null };
type FormFacts = { fieldCount: number; requiredCount: number };
type PageFacts = CrawlPage & {
  normalizedUrl: string;
  clickables: Clickable[];
  forms: FormFacts[];
  normalizedLinks: string[];
  bodyText: string;
  h1: string;
  trustSignals: TrustSignalType[];
};

const CLEAR_CTA = /\b(offerte|prijsopgave|advies|afspraak|consult|plan|boek|bel|demo|aanvragen|start|kennismak|quote|estimate|call|book|schedule|get started|talk to)\b/i;
const GENERIC_CTA = /\b(contact|lees meer|meer informatie|ontdek|bekijk|learn more|read more|discover)\b/i;
const CONTACT_PATH = /\/(contact|afspraak|offerte|boeken|book|booking|quote|aanvraag|consult)/i;
const GENERIC_SERVICE_PATH = /^\/(diensten?|services?|oplossingen?|solutions?|aanbod)\/?$/i;
const SERVICE_PARENT_PATH = /\/(diensten?|services?|oplossingen?|solutions?|aanbod)\//i;
const NON_SERVICE_PATH = /\/(contact|over-ons|about|team|blog|nieuws|news|cases?|projecten?|privacy|voorwaarden|terms|vacatures?|jobs?)(\/|$)/i;
const ADD_TO_CART = /\b(add to (cart|bag|basket)|in winkelmand|toevoegen aan (winkelmand|mandje)|bestel nu|buy now)\b/i;
const CHECKOUT_ACTION = /\b(checkout|afrekenen|naar de kassa|doorgaan met bestellen|secure checkout)\b/i;
const QUOTE_ACTION = /\b(offerte|prijsopgave|quote|estimate)\b/i;
const BOOKING_ACTION = /\b(boek|booking|afspraak|schedule|reserveer|reservation)\b/i;
const DEMO_ACTION = /\b(demo|demonstratie|rondleiding)\b/i;
const APPLICATION_ACTION = /\b(aanvraag|application|apply|solliciteer)\b/i;
const SIGNUP_ACTION = /\b(sign up|signup|registreer|account aanmaken|start trial|proefperiode|abonneer)\b/i;

const CATEGORY_WEIGHTS = {
  "offer-clarity": 35,
  "cta-clarity": 30,
  "customer-journey-path": 35,
  "service-page-coverage": 20,
  "conversion-path-quality": 20,
  "form-friction": 15,
  "message-consistency": 10,
  "trust-signals": 15,
} as const;

const STOP_WORDS = new Set([
  "aan", "als", "bij", "de", "een", "en", "for", "het", "in", "met", "of", "onze",
  "the", "to", "van", "voor", "we", "wij", "your", "uw", "jouw", "op", "is", "zijn",
  "specialist", "welkom", "diensten", "service", "services", "oplossingen", "nederland",
]);

const TRUST_PATTERNS: Array<{ type: TrustSignalType; patterns: RegExp[] }> = [
  {
    type: "Reviews or ratings",
    patterns: [/\b(reviews?|beoordelingen?|rating|sterren|google reviews|klanten geven)\b/i, /aggregateRating|ratingValue/i],
  },
  {
    type: "Testimonials",
    patterns: [/\b(testimonials?|klantverhalen?|wat (onze )?klanten zeggen|ervaringen? van klanten)\b/i, /<blockquote\b/i],
  },
  {
    type: "Client logos",
    patterns: [/\b(onze klanten|klantenlogo|client logos|trusted by|referenties|partners)\b/i, /<(img|section)[^>]+(?:client|customer|partner)[^>]*>/i],
  },
  {
    type: "Certifications",
    patterns: [/\b(gecertificeerd|certificaat|certificering|keurmerk|erkend|iso\s?\d*|kiwa|vca)\b/i],
  },
  {
    type: "Case studies",
    patterns: [/\b(case studies|cases|klantcases|projecten|succesverhalen?|resultaten voor)\b/i],
  },
  {
    type: "Guarantees",
    patterns: [/\b(garantie|gegarandeerd|niet goed.{0,20}geld terug|tevredenheidsgarantie|satisfaction guarantee)\b/i],
  },
  {
    type: "Delivery or returns",
    patterns: [/\b(bezorging|verzending|levertijd|delivery|shipping|retourneren|retourbeleid|returns policy|gratis retour)\b/i],
  },
  {
    type: "Payment information",
    patterns: [/\b(iDEAL|betaalmethoden|veilig betalen|payment methods?|creditcard|paypal|achteraf betalen)\b/i],
  },
];

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanText(value: string) {
  return decodeEntities(value.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function getAttribute(attributes: string, name: string) {
  const match = attributes.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1] || null;
}

function extractClickables(html: string): Clickable[] {
  const items: Clickable[] = [];
  const pattern = /<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html))) {
    const text = cleanText(match[3]);
    if (!text || text.length > 90) continue;
    items.push({ text, href: getAttribute(match[2], "href") });
  }

  return items;
}

function extractForms(html: string): FormFacts[] {
  const forms: FormFacts[] = [];
  const formPattern = /<form\b[^>]*>([\s\S]*?)<\/form>/gi;
  let formMatch: RegExpExecArray | null;

  while ((formMatch = formPattern.exec(html))) {
    const controls = formMatch[1].match(/<(input|textarea|select)\b[^>]*>/gi) || [];
    const usable = controls.filter((control) => !/type\s*=\s*["'](?:hidden|submit|button|reset)["']/i.test(control));
    forms.push({
      fieldCount: usable.length,
      requiredCount: usable.filter((control) => /\brequired\b|aria-required\s*=\s*["']true["']/i.test(control)).length,
    });
  }

  return forms;
}

export function detectTrustSignals(text: string, html = ""): TrustSignalType[] {
  const signals = new Set<TrustSignalType>();
  const combined = `${text}\n${html}`;

  for (const signal of TRUST_PATTERNS) {
    if (signal.patterns.some((pattern) => pattern.test(combined))) signals.add(signal.type);
  }

  const hasEmail = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text);
  const hasPhone = /(?:\+31|0)[\s().-]*(?:\d[\s().-]*){8,10}/.test(text);
  const hasAddress = /\b\d{4}\s?[A-Z]{2}\b/i.test(text) || /\b(kvk|kamer van koophandel)\b/i.test(text);
  if (hasEmail || hasPhone || hasAddress) signals.add("Contact details");

  return [...signals];
}

function buildFacts(pages: CrawlPage[], analyzedUrl: string): PageFacts[] {
  const origin = new URL(analyzedUrl).origin;

  return pages.map((page) => {
    const normalizedUrl = normalizePageUrl(page.url, analyzedUrl) || page.url;
    const clickables = extractClickables(page.html);
    const rawLinks = [
      ...page.links,
      ...clickables.map((item) => item.href).filter((href): href is string => Boolean(href)),
    ];
    const normalizedLinks = Array.from(
      new Set(
        rawLinks
          .map((link) => normalizePageUrl(link, page.url))
          .filter((link): link is string => link !== null)
          .filter((link) => new URL(link).origin === origin),
      ),
    );
    const bodyText = cleanText(page.html) || cleanText(page.markdown);
    const h1Markup = page.html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "";

    return {
      ...page,
      normalizedUrl,
      clickables,
      forms: extractForms(page.html),
      normalizedLinks,
      bodyText,
      h1: cleanText(h1Markup),
      trustSignals: detectTrustSignals(bodyText, page.html),
    };
  });
}

function findHomepage(pages: PageFacts[], analyzedUrl: string) {
  const target = normalizePageUrl(analyzedUrl, analyzedUrl);
  return (
    pages.find((page) => page.normalizedUrl === target) ||
    [...pages].sort((a, b) => new URL(a.normalizedUrl).pathname.length - new URL(b.normalizedUrl).pathname.length)[0]
  );
}

function isContactPage(page: PageFacts) {
  return CONTACT_PATH.test(new URL(page.normalizedUrl).pathname) || page.forms.length > 0;
}

function isSpecificServicePage(page: PageFacts, serviceOverviewLinks: Set<string>) {
  const path = new URL(page.normalizedUrl).pathname;
  if (NON_SERVICE_PATH.test(path) || path === "/") return false;
  if (SERVICE_PARENT_PATH.test(path)) return true;
  return serviceOverviewLinks.has(page.normalizedUrl) && !GENERIC_SERVICE_PATH.test(path);
}

function confidenceFor(pages: number, evidenceItems = 1): Confidence {
  if (pages >= 4 && evidenceItems >= 2) return "High";
  if (pages >= 2 || evidenceItems >= 2) return "Medium";
  return "Low";
}

function severityFor(impact: number): Severity {
  if (impact >= 85) return "Critical";
  if (impact >= 65) return "High";
  if (impact >= 40) return "Medium";
  return "Low";
}

function pageLabel(page: PageFacts, homepage: PageFacts) {
  if (page.normalizedUrl === homepage.normalizedUrl) return "Homepage";
  if (isContactPage(page)) return "Contact page";
  return page.title || "Crawled page";
}

function shortestConversionPath(pages: PageFacts[], homepage: PageFacts) {
  const pageMap = new Map(pages.map((page) => [page.normalizedUrl, page]));
  const queue: Array<{ url: string; path: string[] }> = [{ url: homepage.normalizedUrl, path: [homepage.normalizedUrl] }];
  const visited = new Set([homepage.normalizedUrl]);

  while (queue.length) {
    const current = queue.shift()!;
    const page = pageMap.get(current.url);
    if (!page) continue;
    if (isContactPage(page)) return current.path;

    for (const link of page.normalizedLinks) {
      if (!visited.has(link) && pageMap.has(link)) {
        visited.add(link);
        queue.push({ url: link, path: [...current.path, link] });
      }
    }
  }

  return null;
}

function inferCompanyName(homepage: PageFacts) {
  const segment = homepage.title.split(/\s+[|—–-]\s+/)[0]?.trim();
  if (segment && !/^home(page)?$/i.test(segment)) return segment.slice(0, 80);
  return new URL(homepage.url).hostname.replace(/^www\./, "").split(".")[0]
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function inferPrimaryService(homepage: PageFacts, servicePages: PageFacts[]) {
  if (homepage.h1 && homepage.h1.length <= 110) return homepage.h1;
  if (servicePages[0]?.title) return servicePages[0].title.split(/\s+[|—–-]\s+/)[0].slice(0, 100);
  if (homepage.description) return homepage.description.split(/[.!?]/)[0].slice(0, 110);
  return "Primary business service";
}

function inferMarket(pages: PageFacts[]) {
  const text = pages.map((page) => page.bodyText).join(" ");
  const cities = [
    "Amsterdam", "Rotterdam", "Den Haag", "Utrecht", "Eindhoven", "Groningen", "Tilburg",
    "Almere", "Breda", "Nijmegen", "Apeldoorn", "Haarlem", "Arnhem", "Amersfoort", "Leiden",
    "Delft", "Zwolle", "Maastricht", "Enschede", "Den Bosch",
  ];
  const city = cities.find((candidate) => new RegExp(`\\b${candidate.replace(" ", "\\s+")}\\b`, "i").test(text));
  const geography = /\b(heel|door heel) nederland\b/i.test(text) ? "Nederland" : city || "Nederland";
  const business = /\b(mkb|bedrijven|zakelijk|ondernemers|organisaties|b2b)\b/i.test(text);
  const consumer = /\b(particulieren|consumenten|woningeigenaren|huiseigenaren|gezinnen|thuis)\b/i.test(text);
  const targetCustomer = business && consumer ? "bedrijven en particulieren" : business ? "bedrijven" : consumer ? "particulieren" : "Nederlandse klanten";
  return { geography, targetCustomer };
}

function journeyPageType(page: PageFacts, homepage: PageFacts): JourneyPageType {
  if (page.normalizedUrl === homepage.normalizedUrl) return "Homepage";
  const path = new URL(page.normalizedUrl).pathname.toLowerCase();
  const text = `${path} ${page.title} ${page.h1}`;
  if (/\/(checkout|afrekenen|kassa|payment|betalen)(\/|$)/i.test(path)) return "Checkout";
  if (/\/(cart|basket|bag|winkelmand|mandje)(\/|$)/i.test(path)) return "Cart";
  if (/\/(booking|boeken|afspraak|reserveer)(\/|$)/i.test(path)) return "Booking";
  if (/\/(offerte|quote|prijsopgave|aanvraag)(\/|$)/i.test(path)) return "Quote";
  if (/\/(application|apply|inschrijven)(\/|$)/i.test(path)) return "Application";
  if (/\/(contact)(\/|$)/i.test(path)) return "Contact";
  if (/\/(pricing|prijzen|tarieven|abonnementen)(\/|$)/i.test(path)) return "Pricing";
  if (/\/(products?|product|p)\//i.test(path) || ADD_TO_CART.test(page.bodyText)) return "Product";
  if (/\/(collections?|collecties?|categories?|categorie|catalogus|shop|winkel)\//i.test(path)) return "Category";
  if (/\/(diensten?|services?|oplossingen?|solutions?)\//i.test(path) || /\b(service|dienst|oplossing)\b/i.test(text)) return "Service";
  if (/\/(delivery|shipping|bezorg|retour|returns?|garantie|guarantee|faq|veelgestelde-vragen)(\/|$)/i.test(path)) return "Trust";
  return "Other";
}

function conversionTypeFor(page: PageFacts, type: JourneyPageType): ConversionType {
  const clickText = page.clickables.map((item) => item.text).join(" ");
  if (type === "Checkout") return "Checkout";
  if (type === "Cart") return CHECKOUT_ACTION.test(clickText) ? "Checkout" : "Add to cart";
  if (type === "Product" && ADD_TO_CART.test(clickText)) return "Add to cart";
  if (type === "Booking" || BOOKING_ACTION.test(`${page.title} ${page.h1}`)) return "Appointment booking";
  if (DEMO_ACTION.test(`${page.title} ${page.h1} ${clickText}`)) return "Demo request";
  if (type === "Application" || APPLICATION_ACTION.test(`${page.title} ${page.h1}`)) return "Application";
  if (type === "Quote" || QUOTE_ACTION.test(`${page.title} ${page.h1}`)) return "Quote request";
  if (SIGNUP_ACTION.test(`${page.title} ${page.h1} ${clickText}`)) return "Signup or subscription";
  if (page.forms.length) return type === "Contact" ? "Lead form" : "Lead form";
  if (type === "Contact") return "Contact";
  return "No clear conversion";
}

type JourneyEdge = { from: string; to: string; action: string; ctaText: string | null; visible: boolean };

function journeyEdges(pages: PageFacts[], homepage: PageFacts) {
  const pageMap = new Map(pages.map((page) => [page.normalizedUrl, page]));
  const edges: JourneyEdge[] = [];
  for (const page of pages) {
    for (const link of page.normalizedLinks) {
      if (!pageMap.has(link)) continue;
      const clickable = page.clickables.find((item) => item.href && normalizePageUrl(item.href, page.url) === link);
      edges.push({ from: page.normalizedUrl, to: link, action: clickable?.text ? `Click “${clickable.text}”` : "Open the next page", ctaText: clickable?.text || null, visible: Boolean(clickable?.text) });
    }
  }
  const cart = pages.find((page) => journeyPageType(page, homepage) === "Cart");
  const checkout = pages.find((page) => journeyPageType(page, homepage) === "Checkout");
  if (cart) {
    for (const page of pages.filter((candidate) => candidate.clickables.some((item) => ADD_TO_CART.test(item.text)))) {
      if (!edges.some((edge) => edge.from === page.normalizedUrl && edge.to === cart.normalizedUrl)) {
        const cta = page.clickables.find((item) => ADD_TO_CART.test(item.text));
        edges.push({ from: page.normalizedUrl, to: cart.normalizedUrl, action: `Click “${cta?.text || "Add to cart"}”`, ctaText: cta?.text || "Add to cart", visible: true });
      }
    }
  }
  if (cart && checkout && !edges.some((edge) => edge.from === cart.normalizedUrl && edge.to === checkout.normalizedUrl)) {
    const cta = cart.clickables.find((item) => CHECKOUT_ACTION.test(item.text));
    if (cta) edges.push({ from: cart.normalizedUrl, to: checkout.normalizedUrl, action: `Click “${cta.text}”`, ctaText: cta.text, visible: true });
  }
  return edges;
}

function shortestJourneyRoute(homepage: PageFacts, targets: Set<string>, edges: JourneyEdge[]) {
  const queue: string[][] = [[homepage.normalizedUrl]];
  const visited = new Set([homepage.normalizedUrl]);
  while (queue.length) {
    const route = queue.shift()!;
    const current = route[route.length - 1];
    if (targets.has(current)) return route;
    for (const edge of edges.filter((item) => item.from === current)) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      queue.push([...route, edge.to]);
    }
  }
  return null;
}

function buildJourneyAnalysis(pages: PageFacts[], homepage: PageFacts, primaryService: string, commercialModel: CommercialModel): JourneyAnalysis {
  const businessModels = publicBusinessModels(commercialModel, pages.map((page) => page.bodyText).join(" "));
  const typedPages = pages.map((page) => ({ page, type: journeyPageType(page, homepage), conversion: conversionTypeFor(page, journeyPageType(page, homepage)) }));
  const priority: ConversionType[] = businessModels.includes("Ecommerce")
    ? ["Checkout", "Add to cart", "Quote request", "Lead form", "Contact"]
    : businessModels.includes("Appointment or booking")
      ? ["Appointment booking", "Quote request", "Lead form", "Contact"]
      : businessModels.includes("Software or subscription")
        ? ["Signup or subscription", "Demo request", "Lead form", "Contact"]
        : ["Quote request", "Appointment booking", "Demo request", "Application", "Lead form", "Contact"];
  const primaryConversionType = priority.find((type) => typedPages.some((item) => item.conversion === type)) || "No clear conversion";
  let targetPages = typedPages.filter((item) => item.conversion === primaryConversionType);
  if (primaryConversionType === "Checkout" && targetPages.some((item) => item.type === "Checkout")) {
    targetPages = targetPages.filter((item) => item.type === "Checkout");
  }
  const targets = new Set(targetPages.map((item) => item.page.normalizedUrl));
  const edges = journeyEdges(pages, homepage);
  const discoveredRoute = targets.size ? shortestJourneyRoute(homepage, targets, edges) : null;
  const route = discoveredRoute && (discoveredRoute.length > 1 || homepage.forms.length > 0) ? discoveredRoute : null;
  const pageMap = new Map(pages.map((page) => [page.normalizedUrl, page]));
  const destination = route ? pageMap.get(route[route.length - 1]) || null : null;
  const stages: JourneyStage[] = (route || [homepage.normalizedUrl]).map((url, index, all) => {
    const page = pageMap.get(url) || homepage;
    const next = all[index + 1];
    const edge = next ? edges.find((item) => item.from === url && item.to === next) : null;
    const type = journeyPageType(page, homepage);
    const generic = edge?.ctaText ? GENERIC_CTA.test(edge.ctaText) : false;
    return {
      order: index + 1,
      pageType: type,
      title: page.title,
      url: page.url,
      action: edge?.action || `Reach the ${primaryConversionType.toLowerCase()} interface`,
      ctaText: edge?.ctaText || null,
      nextStepVisible: edge ? edge.visible : true,
      necessary: true,
      friction: page.statusCode >= 400 ? `Page returned HTTP ${page.statusCode}.` : generic ? `The route uses the generic CTA “${edge?.ctaText}”.` : null,
    };
  });
  const destinationForm = destination?.forms[0];
  const additionalObservableActions = destinationForm
    ? destinationForm.requiredCount + 1
    : primaryConversionType === "Add to cart" ? 1 : null;
  const confidence = route && pages.length >= 4 ? "High" : route ? "Medium" : "Low";
  const limitations = [
    "No purchase, account creation or form submission was completed.",
    "Dynamic, personalized, logged-in and payment steps may not be visible in public HTML.",
    "The detected shortest path may differ from routes used by real visitors.",
  ];
  return {
    businessModels,
    primaryOffer: primaryService,
    primaryConversionType,
    primary: {
      name: primaryConversionType === "No clear conversion" ? "Primary commercial journey not confirmed" : `${primaryConversionType} journey`,
      conversionType: primaryConversionType,
      startUrl: homepage.url,
      destinationUrl: destination?.url || null,
      clicksToInterface: route ? Math.max(0, route.length - 1) : null,
      additionalObservableActions,
      stages,
      shortestRoute: route || [],
      alternativeRoute: null,
      confidence,
      limitations,
    },
    secondary: [],
  };
}

function category(
  id: ReadinessCategory["id"],
  label: string,
  score: number | null,
  confidence: Confidence,
  explanation: string,
  evidence: Evidence[],
): ReadinessCategory {
  return { id, label, score, weight: CATEGORY_WEIGHTS[id], confidence, explanation, evidence };
}

function offerCategory(homepage: PageFacts, pages: PageFacts[], primaryService: string) {
  const h1 = homepage.h1.trim();
  const title = homepage.title.trim();
  const description = homepage.description.trim();
  const generic = /^(home(page)?|welkom|welcome|dille\s*&\s*kamille)$/i;
  const offerTokens = meaningfulTokens(`${h1} ${primaryService}`).slice(0, 6);
  const sources = [title, h1, description].filter(Boolean);
  const repeatedSources = sources.filter((source) => offerTokens.some((token) => source.toLowerCase().includes(token))).length;

  let score = 10;
  if (h1.length >= 12 && h1.length <= 120 && !generic.test(h1)) score += 35;
  if (title.length >= 8 && !generic.test(title)) score += 20;
  if (description.length >= 45) score += 20;
  if (repeatedSources >= 2) score += 15;
  score = Math.min(100, score);

  const explanation = score >= 80
    ? "The landing page states the offer clearly and repeats it in key page copy."
    : score >= 60
      ? "The main offer is present, but visitors may need supporting copy to understand it immediately."
      : "The landing page does not make the primary offer immediately clear from its main heading and metadata.";
  const statement = `Offer clarity scored ${score}/100 from the page title, primary heading and description. ${h1 ? `Detected heading: “${h1}”.` : "No readable H1 heading was detected."}`;

  return category(
    "offer-clarity",
    "Offer Clarity",
    score,
    confidenceFor(pages.length, sources.length),
    explanation,
    [{ statement, pageLabel: "Homepage", url: homepage.url }],
  );
}

function ctaCategory(homepage: PageFacts, pages: PageFacts[], commercialModel: CommercialModel) {
  const ecommerceCta = /\b(shop( nu)?|bekijk (de )?collectie|producten bekijken|bestel( nu)?|naar de winkel|ontdek de collectie)\b/i;
  const clearPattern = commercialModel === "ecommerce" || commercialModel === "marketplace" ? new RegExp(`${CLEAR_CTA.source}|${ecommerceCta.source}`, "i") : CLEAR_CTA;
  const relevant = homepage.clickables.filter((item) => clearPattern.test(item.text) || GENERIC_CTA.test(item.text));
  const clear = relevant.filter((item) => clearPattern.test(item.text));
  const generic = relevant.filter((item) => GENERIC_CTA.test(item.text));
  const score = clear.length >= 2 ? 92 : clear.length === 1 ? 72 : generic.length ? 35 : 12;
  const statement = clear.length
    ? `${clear.length} clear homepage CTA${clear.length === 1 ? " was" : "s were"} detected: ${clear.map((item) => `“${item.text}”`).join(", ")}.`
    : generic.length
      ? `Only generic homepage prompts were detected: ${generic.map((item) => `“${item.text}”`).join(", ")}.`
      : "No quote, booking, consultation or call CTA was detected in homepage links or buttons.";
  return category(
    "cta-clarity",
    "CTA Clarity",
    score,
    confidenceFor(pages.length, clear.length + generic.length),
    clear.length ? "Clear buying actions are present on the homepage." : "The homepage does not present a specific buying action.",
    [{ statement, pageLabel: "Homepage", url: homepage.url }],
  );
}

function serviceCategory(homepage: PageFacts, pages: PageFacts[], servicePages: PageFacts[], internalLinkCount: number, commercialModel: CommercialModel) {
  if (commercialModel === "ecommerce" || commercialModel === "marketplace") {
    const categoryPages = pages.filter((page) => journeyPageType(page, homepage) === "Category");
    const productPages = pages.filter((page) => journeyPageType(page, homepage) === "Product");
    const score = categoryPages.length && productPages.length ? 95 : productPages.length ? 72 : categoryPages.length ? 58 : 20;
    const evidencePage = productPages[0] || categoryPages[0] || homepage;
    const statement = categoryPages.length && productPages.length
      ? "A representative category and product-detail step were both detected in the customer journey."
      : productPages.length
        ? "A product-detail step was detected, but no representative category step was confirmed."
        : categoryPages.length
          ? "A category step was detected, but no representative product-detail step was confirmed."
          : "No representative category or product-detail step was confirmed from the landing page.";
    return category(
      "service-page-coverage",
      "Product-journey coverage",
      score,
      confidenceFor(pages.length, categoryPages.length + productPages.length || 1),
      statement,
      [{ statement, pageLabel: pageLabel(evidencePage, homepage), url: evidencePage.url }],
    );
  }

  if (commercialModel === "software") {
    const pricingPage = pages.find((page) => journeyPageType(page, homepage) === "Pricing");
    const score = pricingPage ? 90 : servicePages.length ? 65 : 25;
    const evidencePage = pricingPage || servicePages[0] || homepage;
    const statement = pricingPage ? "A representative pricing step was detected before signup or demo conversion." : "No representative pricing step was confirmed in the public conversion journey.";
    return category("service-page-coverage", "Offer and pricing coverage", score, confidenceFor(pages.length, pricingPage ? 2 : 1), statement, [{ statement, pageLabel: pageLabel(evidencePage, homepage), url: evidencePage.url }]);
  }

  const score = servicePages.length >= 3 ? 95 : servicePages.length === 2 ? 82 : servicePages.length === 1 ? 58 : 20;
  const statement = servicePages.length
    ? `${servicePages.length} dedicated service page${servicePages.length === 1 ? " was" : "s were"} detected across ${pages.length} crawled pages.`
    : `No service-specific page was found in ${internalLinkCount} internal links; only overview or general pages were detected.`;
  return category(
    "service-page-coverage",
    "Service-page coverage",
    score,
    confidenceFor(pages.length, servicePages.length || 1),
    servicePages.length >= 2 ? "The offer is supported by specific commercial pages." : "The offer has limited service-specific coverage.",
    [{ statement, pageLabel: pageLabel(servicePages[0] || homepage, homepage), url: (servicePages[0] || homepage).url }],
  );
}

function conversionCategory(homepage: PageFacts, pages: PageFacts[], path: string[] | null) {
  const broken = pages.find((page) => isContactPage(page) && page.statusCode >= 400);
  const destination = path ? pages.find((page) => page.normalizedUrl === path[path.length - 1]) : null;
  const steps = path ? Math.max(0, path.length - 1) : null;
  let score = 10;
  let statement = "No reachable contact, quote, booking or form destination was found from the homepage within the crawled pages.";

  if (broken) {
    score = 0;
    statement = `${broken.title} returned HTTP ${broken.statusCode}.`;
  } else if (steps === 0) {
    score = 94;
    statement = "A conversion form was detected directly on the homepage.";
  } else if (steps === 1) {
    score = 90;
    statement = `The shortest detected route contains 1 click: Homepage → ${destination?.title || "conversion page"}.`;
  } else if (steps === 2) {
    score = 62;
    statement = `The shortest detected route contains 2 clicks: ${path?.map((url, index) => index === 0 ? "Homepage" : pages.find((page) => page.normalizedUrl === url)?.title || new URL(url).pathname).join(" → ")}.`;
  } else if (steps !== null && steps >= 3) {
    score = 30;
    statement = `The shortest detected route contains ${steps} clicks: ${path?.map((url, index) => index === 0 ? "Homepage" : pages.find((page) => page.normalizedUrl === url)?.title || new URL(url).pathname).join(" → ")}.`;
  }

  return category(
    "customer-journey-path",
    "Customer Journey Path",
    score,
    confidenceFor(pages.length, path?.length || 1),
    broken ? "A visible conversion destination returned an error." : steps === null ? "No complete conversion route was visible in the bounded crawl." : `The shortest visible conversion route takes ${steps} click${steps === 1 ? "" : "s"}.`,
    [{ statement, pageLabel: broken ? "Failing destination" : "Detected conversion route", url: (broken || destination || homepage).url }],
  );
}

function formCategory(homepage: PageFacts, pages: PageFacts[], destination: PageFacts | null) {
  const forms = pages.flatMap((page) => page.forms.map((form) => ({ page, form })));
  if (!forms.length) {
    return category(
      "form-friction",
      "Form friction",
      null,
      "Low",
      "No HTML form was available, so field-level friction cannot be assessed.",
      [{ statement: "No HTML form was detected in the crawled pages.", pageLabel: "Crawl inventory", url: homepage.url }],
    );
  }

  const preferred = forms.find((item) => item.page === destination) || [...forms].sort((a, b) => a.form.fieldCount - b.form.fieldCount)[0];
  const fields = preferred.form.fieldCount;
  const required = preferred.form.requiredCount;
  let score = fields <= 4 ? 92 : fields <= 7 ? 72 : fields <= 10 ? 45 : 18;
  if (required >= 6) score = Math.max(0, score - 12);
  const statement = `The shortest detected form contains ${fields} visible field${fields === 1 ? "" : "s"}; ${required} appear required.`;
  return category(
    "form-friction",
    "Form friction",
    score,
    confidenceFor(pages.length, 2),
    fields <= 4 ? "The detected form asks for relatively little information." : "The detected form may ask for more information than an initial enquiry needs.",
    [{ statement, pageLabel: pageLabel(preferred.page, homepage), url: preferred.page.url }],
  );
}

function meaningfulTokens(value: string) {
  return Array.from(new Set(value.toLowerCase().replace(/[^a-zà-ÿ0-9\s-]/g, " ").split(/[\s-]+/).filter((token) => token.length >= 4 && !STOP_WORDS.has(token))));
}

function messageCategory(homepage: PageFacts, pages: PageFacts[], servicePages: PageFacts[], primaryService: string) {
  const sources = [homepage.title, homepage.h1, homepage.description, ...servicePages.slice(0, 2).flatMap((page) => [page.title, page.h1])]
    .map((source) => source.trim())
    .filter(Boolean);
  const tokens = meaningfulTokens(`${primaryService} ${homepage.h1}`).slice(0, 5);
  if (sources.length < 2 || !tokens.length) {
    return category(
      "message-consistency",
      "Message consistency",
      null,
      "Low",
      "The crawl did not contain enough comparable headings and descriptions.",
      [{ statement: `Only ${sources.length} usable message source${sources.length === 1 ? " was" : "s were"} found.`, pageLabel: "Content inventory", url: homepage.url }],
    );
  }

  const matching = sources.filter((source) => tokens.some((token) => source.toLowerCase().includes(token)));
  const score = Math.round((matching.length / sources.length) * 100);
  return category(
    "message-consistency",
    "Message consistency",
    score,
    confidenceFor(pages.length, sources.length),
    `${matching.length} of ${sources.length} key titles, headings and descriptions repeat the main service language.`,
    [{ statement: `Main service terms (${tokens.join(", ")}) appear in ${matching.length} of ${sources.length} comparable message sources.`, pageLabel: "Homepage and service-page copy", url: homepage.url }],
  );
}

function trustCategory(homepage: PageFacts, pages: PageFacts[], servicePages: PageFacts[], destination: PageFacts | null) {
  const importantPages = Array.from(new Set([homepage, ...servicePages, ...(destination ? [destination] : [])])).filter((page) => page.bodyText.length >= 80);
  if (!importantPages.length) {
    return category("trust-signals", "Trust signals", null, "Low", "Important commercial pages were not readable.", [],);
  }

  const pagesWithTrust = importantPages.filter((page) => page.trustSignals.length > 0);
  const uniqueSignals = new Set(importantPages.flatMap((page) => page.trustSignals));
  const coverage = pagesWithTrust.length / importantPages.length;
  const score = Math.round(coverage * 70 + Math.min(uniqueSignals.size / 3, 1) * 30);
  const primaryPage = destination || servicePages[0] || homepage;
  const primarySignals = primaryPage.trustSignals;
  const statement = primarySignals.length
    ? `${primarySignals.join(", ")} ${primarySignals.length === 1 ? "was" : "were"} visible on the main conversion page.`
    : "No visible review, testimonial, client-logo, certification, case-study, guarantee or contact-detail evidence was detected on the main conversion page.";
  return category(
    "trust-signals",
    "Trust signals",
    score,
    confidenceFor(pages.length, importantPages.length),
    `${pagesWithTrust.length} of ${importantPages.length} important commercial pages contain at least one visible trust signal.`,
    [{ statement, pageLabel: pageLabel(primaryPage, homepage), url: primaryPage.url }],
  );
}

function requiredFinding(item: ReadinessCategory, homepage: PageFacts, rank: number, clicks: number | null): Gap {
  const score = item.score ?? 0;
  const shared = {
    rank,
    severity: severityFor(100 - score),
    score,
    confidence: item.confidence,
    evidence: item.evidence.length ? item.evidence : [{ statement: item.explanation, pageLabel: "Crawl evidence", url: homepage.url }],
  };

  if (item.id === "offer-clarity") {
    return {
      ...shared,
      id: "offer-clarity",
      title: "Offer Clarity",
      summary: item.explanation,
      nextAction: score >= 80 ? "Keep the primary offer consistent across the journey." : "State the product or service and customer outcome in the main heading.",
    };
  }

  if (item.id === "cta-clarity") {
    return {
      ...shared,
      id: "cta-clarity",
      title: "CTA Clarity",
      summary: item.explanation,
      nextAction: score >= 80 ? "Keep one primary CTA label consistent on every journey page." : "Use one obvious, specific conversion CTA on the landing page.",
    };
  }

  return {
    ...shared,
    id: "customer-journey-path",
    title: "Customer Journey Path",
    summary: clicks === null ? "A complete public route to conversion could not be confirmed." : `The shortest evidenced route reaches conversion in ${clicks} click${clicks === 1 ? "" : "s"}.`,
    nextAction: clicks === null ? "Expose a direct route to the primary conversion." : clicks <= 2 ? "Keep the shortest conversion route prominent." : "Remove intermediate steps from the primary conversion route.",
  };
}

function scoreLabel(score: number | null) {
  if (score === null) return "Insufficient data";
  if (score >= 80) return "Strong foundation";
  if (score >= 65) return "Nearly conversion-ready";
  if (score >= 50) return "Room to convert";
  return "Leaking demand";
}

function pageType(page: PageFacts, homepage: PageFacts, servicePages: PageFacts[]) {
  if (page.normalizedUrl === homepage.normalizedUrl) return "Homepage" as const;
  if (isContactPage(page)) return "Contact" as const;
  if (servicePages.includes(page) || GENERIC_SERVICE_PATH.test(new URL(page.normalizedUrl).pathname)) return "Service" as const;
  return "Other" as const;
}

export function analyzeCrawl(crawledPages: CrawlPage[], analyzedUrl: string, processingMs: number): AnalysisResult {
  const pages = buildFacts(crawledPages, analyzedUrl);
  const homepage = findHomepage(pages, analyzedUrl);
  if (!homepage) throw new Error("A homepage could not be identified in the crawl results.");

  const overviewLinks = new Set(
    pages.filter((page) => GENERIC_SERVICE_PATH.test(new URL(page.normalizedUrl).pathname)).flatMap((page) => page.normalizedLinks),
  );
  const servicePages = pages.filter((page) => isSpecificServicePage(page, overviewLinks));
  const internalLinks = new Set(pages.flatMap((page) => page.normalizedLinks));
  const primaryService = inferPrimaryService(homepage, servicePages);
  const market = inferMarket(pages);
  const commercialModel = classifyCommercialModel(pages);
  const journey = buildJourneyAnalysis(pages, homepage, primaryService, commercialModel);
  const fallbackPath = shortestConversionPath(pages, homepage);
  const detectedPath = journey.primary.shortestRoute.length ? journey.primary.shortestRoute : fallbackPath;
  const path = detectedPath && (detectedPath.length > 1 || homepage.forms.length > 0) ? detectedPath : null;
  const destination = path ? pages.find((page) => page.normalizedUrl === path[path.length - 1]) || null : null;

  const categories = [
    offerCategory(homepage, pages, primaryService),
    ctaCategory(homepage, pages, commercialModel),
    conversionCategory(homepage, pages, path),
  ];
  const assessedWeight = categories.reduce((sum, item) => sum + item.weight, 0);
  const minimumWeight = 100;
  const readablePages = pages.filter((page) => page.bodyText.length >= 80).length;
  const score = Math.round(categories.reduce((sum, item) => sum + (item.score ?? 0) * item.weight, 0) / assessedWeight);
  const reportConfidence = confidenceFor(readablePages, categories.length);
  const clicks = path ? Math.max(0, path.length - 1) : null;
  const gaps: Gap[] = categories.map((item, index) => requiredFinding(item, homepage, index + 1, clicks));
  const companyName = inferCompanyName(homepage);
  const searchQuery = `${primaryService} ${market.geography} ${market.targetCustomer}`.replace(/\s+/g, " ").trim();

  return {
    id: crypto.randomUUID(),
    mode: "live",
    url: analyzedUrl,
    companyName,
    primaryService,
    score,
    scoreLabel: scoreLabel(score),
    readiness: {
      status: "scored",
      score,
      assessedWeight,
      minimumWeight,
      formula: "Σ(category score × category weight) ÷ Σ(assessed category weights)",
      categories,
    },
    confidence: reportConfidence,
    analyzedAt: new Date().toISOString(),
    summary: `Representative journey score: ${score}/100 across offer clarity, CTA clarity and customer journey path.`,
    overview: {
      score,
      status: score >= 80 ? "Strong" : score >= 60 ? "Mixed" : "Needs attention",
      explanation: score >= 80 ? "The representative journey is clear and direct." : score >= 60 ? "The journey is usable, with specific opportunities to improve." : "The representative journey contains visible acquisition friction.",
      businessModel: journey.businessModels[0],
      primaryConversion: journey.primaryConversionType,
      estimatedClicks: clicks,
    },
    gaps,
    stats: {
      pagesCrawled: pages.length,
      internalLinks: internalLinks.size,
      ctasFound: pages.reduce((total, page) => total + page.clickables.filter((item) => CLEAR_CTA.test(item.text) || GENERIC_CTA.test(item.text)).length, 0),
      formsFound: pages.reduce((total, page) => total + page.forms.length, 0),
      formFields: pages.reduce((total, page) => total + page.forms.reduce((sum, form) => sum + form.fieldCount, 0), 0),
      servicePages: servicePages.length,
      trustSignals: new Set(pages.flatMap((page) => page.trustSignals)).size,
      conversionPathSteps: clicks,
      processingMs,
    },
    market,
    competitors: {
      status: "skipped",
      label: "Likely public search competitors",
      query: searchQuery,
      geography: market.geography,
      targetCustomer: market.targetCustomer,
      entity: {
        companyName,
        domain: new URL(analyzedUrl).hostname.replace(/^www\./, ""),
        industry: primaryService,
        businessModel: "other",
        offerings: [primaryService],
        geography: market.geography,
        targetCustomer: market.targetCustomer,
        confidence: reportConfidence,
        method: "deterministic",
      },
      note: "Competitor discovery was not run for this result.",
      competitors: [],
    },
    journey,
    pages: pages.map((page) => ({ title: page.title, url: page.url, type: pageType(page, homepage, servicePages), statusCode: page.statusCode })),
    llmEnhanced: false,
  };
}
