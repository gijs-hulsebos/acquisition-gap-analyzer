import type {
  AnalysisResult,
  Confidence,
  ConversionType,
  CrawlPage,
  Evidence,
  Gap,
  JourneyAnalysis,
  JourneyPageType,
  JourneyStage,
  ReadinessCategory,
  Severity,
} from "./types";
import { classifyCommercialModel, publicBusinessModels } from "./journey-model";
import type { CommercialModel } from "./journey-model";
import { normalizePageUrl } from "./url";

type Clickable = { text: string; href: string | null; element: "link" | "button" };
type FormFacts = { fieldCount: number; requiredCount: number; isConversion: boolean };
type PageFacts = CrawlPage & {
  normalizedUrl: string;
  clickables: Clickable[];
  forms: FormFacts[];
  normalizedLinks: string[];
  bodyText: string;
  h1: string;
};

const WEIGHTS = { "offer-clarity": 35, "cta-clarity": 30, "customer-journey-path": 35 } as const;
const ADD_TO_CART = /\b(add to (cart|bag|basket)|in winkelmand|toevoegen aan (winkelmand|mandje)|bestel nu|buy now)\b/i;
const CHECKOUT_ACTION = /\b(checkout|afrekenen|naar de kassa|doorgaan met bestellen|secure checkout)\b/i;
const COMMERCIAL_ACTION = /\b(start|aanvragen|plan|boek|demo|registreer|inschrijven|bestel|koop|subscribe|sign up|get started|book|schedule|request|apply)\b/i;
const GENERIC_ACTION = /\b(contact|lees meer|meer informatie|ontdek|bekijk|learn more|read more|discover)\b/i;
const STOP_WORDS = new Set(["aan", "als", "bij", "de", "een", "en", "for", "het", "in", "met", "of", "onze", "the", "to", "van", "voor", "we", "wij", "your", "uw", "jouw", "op", "is", "zijn", "welkom", "home", "homepage"]);

function decodeEntities(value: string) {
  return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function cleanText(value: string) {
  return decodeEntities(value.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function getAttribute(attributes: string, name: string) {
  return attributes.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1] || null;
}

function extractClickables(html: string): Clickable[] {
  const items: Clickable[] = [];
  const pattern = /<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const text = cleanText(match[3]);
    if (!text || text.length > 90) continue;
    items.push({ text, href: getAttribute(match[2], "href") || getAttribute(match[2], "formaction"), element: match[1].toLowerCase() === "a" ? "link" : "button" });
  }
  return items;
}

function extractForms(html: string): FormFacts[] {
  const forms: FormFacts[] = [];
  const pattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const markup = match[2];
    const controls = markup.match(/<(input|textarea|select)\b[^>]*>/gi) || [];
    const usable = controls.filter((control) => !/type\s*=\s*["'](?:hidden|submit|button|reset)["']/i.test(control));
    const signature = cleanText(`${match[1]} ${markup}`).toLowerCase();
    const utility = /\b(search|zoeken?|newsletter|nieuwsbrief|login|inloggen|filter|sorteren|coupon|kortingscode)\b/i.test(signature);
    const leadFields = /\b(name|naam|email|e-mail)\b/i.test(signature) && /\b(phone|telefoon|message|bericht|company|bedrijf|address|adres)\b/i.test(signature);
    const conversionLanguage = /\b(aanvraag|afspraak|boeking|booking|reserveer|demo|trial|registreer|signup|bestelling plaatsen|place order)\b/i.test(signature);
    forms.push({ fieldCount: usable.length, requiredCount: usable.filter((control) => /\brequired\b|aria-required\s*=\s*["']true["']/i.test(control)).length, isConversion: !utility && (leadFields || conversionLanguage) });
  }
  return forms;
}

function buildFacts(pages: CrawlPage[], analyzedUrl: string): PageFacts[] {
  const origin = new URL(analyzedUrl).origin;
  return pages.flatMap((page) => {
    const normalizedUrl = normalizePageUrl(page.url, analyzedUrl);
    if (!normalizedUrl || new URL(normalizedUrl).origin !== origin) return [];
    const clickables = extractClickables(page.html);
    const normalizedLinks = Array.from(new Set([...page.links, ...clickables.flatMap((item) => item.href ? [item.href] : [])]
      .map((link) => normalizePageUrl(link, page.url))
      .filter((link): link is string => Boolean(link) && new URL(link!).origin === origin)));
    return [{
      ...page,
      normalizedUrl,
      clickables,
      forms: extractForms(page.html),
      normalizedLinks,
      bodyText: cleanText(page.html) || cleanText(page.markdown),
      h1: cleanText(page.html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || ""),
    }];
  });
}

function findHomepage(pages: PageFacts[], analyzedUrl: string) {
  const target = normalizePageUrl(analyzedUrl, analyzedUrl);
  return pages.find((page) => page.normalizedUrl === target) || [...pages].sort((a, b) => new URL(a.normalizedUrl).pathname.length - new URL(b.normalizedUrl).pathname.length)[0];
}

function pageType(page: PageFacts, homepage: PageFacts): JourneyPageType {
  if (page.normalizedUrl === homepage.normalizedUrl) return "Homepage";
  const path = new URL(page.normalizedUrl).pathname.toLowerCase();
  const text = `${path} ${page.title} ${page.h1}`;
  if (/\/(checkout|afrekenen|kassa|payment|betalen)(\/|$)/i.test(path)) return "Checkout";
  if (/\/(cart|basket|bag|winkelmand|mandje)(\/|$)/i.test(path)) return "Cart";
  if (/\/(search|zoeken?|zoekresultaten?)(\/|$)/i.test(path)) return "Category";
  if (/\/(products?|product|p|artikel|item)\//i.test(path) || ADD_TO_CART.test(page.bodyText)) return "Product";
  if (/\/(collections?|collecties?|categories?|categorie|catalogus|shop|winkel|assortiment)(\/|$)/i.test(path)) return "Category";
  if (/\/(pricing|prijzen|tarieven|abonnementen)(\/|$)/i.test(path)) return "Pricing";
  if (/\/(diensten?|services?|oplossingen?|solutions?)(\/|$)/i.test(path) || /\b(service|dienst|oplossing)\b/i.test(text)) return "Service";
  if (page.forms.some((form) => form.isConversion)) return "Other";
  return "Other";
}

function linkedAction(from: PageFacts, to: PageFacts) {
  return from.clickables.find((item) => item.href && normalizePageUrl(item.href, from.url) === to.normalizedUrl) || null;
}

function confidenceFor(pages: number, evidenceItems = 1): Confidence {
  if (pages >= 4 && evidenceItems >= 2) return "High";
  if (pages >= 2 || evidenceItems >= 2) return "Medium";
  return "Low";
}

function severityFor(score: number | null): Severity {
  if (score === null) return "Low";
  if (score <= 20) return "Critical";
  if (score <= 40) return "High";
  if (score <= 65) return "Medium";
  return "Low";
}

function inferCompanyName(homepage: PageFacts) {
  const segment = homepage.title.split(/\s+[|—–-]\s+/)[0]?.trim();
  return segment && !/^home(page)?$/i.test(segment) ? segment.slice(0, 80) : new URL(homepage.url).hostname.replace(/^www\./, "").split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function inferMarket(pages: PageFacts[], model: CommercialModel) {
  const text = pages.map((page) => page.bodyText).join(" ");
  const cities = ["Amsterdam", "Rotterdam", "Den Haag", "Utrecht", "Eindhoven", "Groningen", "Tilburg", "Breda", "Haarlem", "Arnhem", "Leiden", "Zwolle", "Maastricht"];
  const city = cities.find((candidate) => new RegExp(`\\b${candidate.replace(" ", "\\s+")}\\b`, "i").test(text));
  const business = /\b(mkb|bedrijven|zakelijk|ondernemers|organisaties|b2b)\b/i.test(text);
  const consumer = /\b(particulieren|consumenten|woningeigenaren|huiseigenaren|gezinnen|thuis)\b/i.test(text);
  return { geography: /\b(heel|door heel) nederland\b/i.test(text) ? "Nederland" : city || "Nederland", targetCustomer: business && consumer ? "bedrijven en particulieren" : business ? "bedrijven" : consumer || model === "ecommerce" ? "particulieren" : "Nederlandse klanten" };
}

function inferPrimaryOffer(homepage: PageFacts, pages: PageFacts[], model: CommercialModel) {
  const representative = pages.filter((page) => ["Category", "Product", "Service", "Pricing"].includes(pageType(page, homepage))).slice(0, 3);
  const labels = representative.map((page) => page.h1 || page.title).filter(Boolean);
  if ((model === "ecommerce" || model === "marketplace") && labels.length) return `Online assortment: ${labels.join(", ")}`.slice(0, 110);
  if (homepage.h1 && homepage.h1.length <= 110) return homepage.h1;
  if (labels[0]) return labels[0].slice(0, 110);
  return homepage.description.split(/[.!?]/)[0].slice(0, 110) || "Primary offer";
}

function meaningfulTokens(value: string) {
  return Array.from(new Set(value.toLowerCase().replace(/[^a-zà-ÿ0-9\s-]/g, " ").split(/[\s-]+/).filter((token) => token.length >= 4 && !STOP_WORDS.has(token))));
}

function firstSnippet(text: string, pattern: RegExp) {
  return text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).find((sentence) => pattern.test(sentence))?.slice(0, 180) || null;
}

function category(id: ReadinessCategory["id"], label: string, score: number | null, confidence: Confidence, explanation: string, evidence: Evidence[], recommendation: string): ReadinessCategory {
  return { id, label, score, weight: WEIGHTS[id], confidence, explanation, evidence, recommendation };
}

function offerCategory(homepage: PageFacts, pages: PageFacts[], primaryOffer: string, targetCustomer: string) {
  const offerPages = pages.filter((page) => ["Category", "Product", "Service", "Pricing"].includes(pageType(page, homepage)));
  const labels = offerPages.slice(0, 4).map((page) => page.h1 || page.title).filter(Boolean);
  const combined = [homepage.h1, homepage.description, homepage.bodyText.slice(0, 1800), ...offerPages.slice(0, 3).map((page) => `${page.h1} ${page.description} ${page.bodyText.slice(0, 900)}`)].join(" ");
  const tokens = meaningfulTokens(`${primaryOffer} ${labels.join(" ")}`).slice(0, 8);
  const whatClear = Boolean((homepage.h1.length >= 8 && tokens.some((token) => homepage.h1.toLowerCase().includes(token))) || labels.length >= 2);
  const whoSnippet = firstSnippet(combined, /\b(voor (?:bedrijven|ondernemers|organisaties|professionals|particulieren|consumenten|woningeigenaren|gezinnen|kinderen|mannen|vrouwen)|b2b|b2c|zakelijk|thuis)\b/i);
  const whySnippet = firstSnippet(combined, /\b(duurzaam|handgemaakt|kwaliteit|persoonlijk|lokaal|uniek|snelle? levering|gratis (?:verzending|retour|advies)|garantie|vakmanschap|sinds \d{4}|\d+ jaar|betaalbaar|op maat|eigen ontwerp)\b/i);
  const score = (whatClear ? 45 : 10) + (whoSnippet ? 25 : 0) + (whySnippet ? 30 : 0);
  const missing = [!whatClear ? "what is sold" : null, !whoSnippet ? "who it is for" : null, !whySnippet ? "why it is relevant" : null].filter(Boolean);
  const explanation = missing.length ? `The representative content does not clearly establish ${missing.join(" and ")}.` : `The representative content explains what is sold, who it is for and why it is relevant.`;
  const recommendation = !whatClear ? `Name ${primaryOffer} directly in the main heading.` : !whoSnippet ? `State explicitly that the offer is for ${targetCustomer}.` : !whySnippet ? "Add one concrete, verifiable reason to choose this offer." : "Keep the offer, audience and relevance together in the opening content.";
  return category("offer-clarity", "Offer Clarity", score, confidenceFor(pages.length, [whatClear, whoSnippet, whySnippet].filter(Boolean).length), explanation, [
    { statement: whatClear ? `Offer evidence: “${homepage.h1 || labels.join(", ") || primaryOffer}”.` : "The homepage, category and detail content do not clearly name the main offer.", pageLabel: "What is sold", url: homepage.url },
    { statement: whoSnippet ? `Audience evidence: “${whoSnippet}”.` : "No explicit customer statement was detected in the representative content.", pageLabel: "Who it is for", url: homepage.url },
    { statement: whySnippet ? `Relevance evidence: “${whySnippet}”.` : "No concrete benefit or differentiator was detected in the representative content.", pageLabel: "Why it is relevant", url: homepage.url },
  ], recommendation);
}

function buildEcommerceJourney(pages: PageFacts[], homepage: PageFacts, primaryOffer: string): JourneyAnalysis {
  const typed = pages.map((page) => ({ page, type: pageType(page, homepage) }));
  const categoryPage = typed.find((item) => item.type === "Category" && linkedAction(homepage, item.page))?.page || null;
  const product = categoryPage ? typed.find((item) => item.type === "Product" && linkedAction(categoryPage, item.page))?.page || null : null;
  const add = product?.clickables.find((item) => ADD_TO_CART.test(item.text)) || null;
  const cart = typed.find((item) => item.type === "Cart")?.page || null;
  const checkout = typed.find((item) => item.type === "Checkout")?.page || null;
  const cartEmpty = Boolean(cart && /\b(cart|basket|bag|winkelmand(?:je)?|mandje)\s+(is\s+)?(empty|leeg)|geen\s+(artikelen|producten)\s+in\s+(je|uw|de)\s+(winkelmand|mandje)/i.test(cart.bodyText));
  const populatedCart = Boolean(cart && !cartEmpty && /\b(aantal|quantity|qty|verwijder|remove|subtotal|subtotaal)\b|(?:€|eur\s*)\s*\d|cart-item|line-item/i.test(`${cart.bodyText} ${cart.html}`));
  const addToCartLink = Boolean(add?.href && cart && normalizePageUrl(add.href, product?.url || homepage.url) === cart.normalizedUrl);
  const openCart = product && cart ? linkedAction(product, cart) || linkedAction(homepage, cart) : null;
  const checkoutAction = cart && checkout && populatedCart ? cart.clickables.find((item) => CHECKOUT_ACTION.test(item.text) && item.href && normalizePageUrl(item.href, cart.url) === checkout.normalizedUrl) || null : null;
  const missing = [!categoryPage ? "homepage → category/search" : null, !product ? "category/search → product" : null, !add ? "Add to cart" : null, !cart ? "cart page" : null, cart && !populatedCart ? "populated cart state" : null, cart && !addToCartLink && !openCart ? "product → cart action" : null, !checkout ? "checkout page" : null, cart && checkout && !checkoutAction ? "cart → checkout action" : null].filter((item): item is string => Boolean(item));
  const complete = missing.length === 0;
  let actions = 0;
  const stages: JourneyStage[] = [];
  if (categoryPage) { const action = linkedAction(homepage, categoryPage)!; actions += 1; stages.push({ order: stages.length + 1, pageType: "Homepage", title: homepage.title, url: homepage.url, action: `Click “${action.text}”`, ctaText: action.text, nextStepVisible: true, necessary: true, friction: null }); }
  if (categoryPage && product) { const action = linkedAction(categoryPage, product)!; actions += 1; stages.push({ order: stages.length + 1, pageType: "Category", title: categoryPage.title, url: categoryPage.url, action: `Click “${action.text}”`, ctaText: action.text, nextStepVisible: true, necessary: true, friction: null }); }
  if (product && add) { actions += 1; stages.push({ order: stages.length + 1, pageType: "Product", title: product.title, url: product.url, action: `Click “${add.text}”`, ctaText: add.text, nextStepVisible: true, necessary: true, friction: null }); }
  if (cart && openCart && !addToCartLink) actions += 1;
  if (cart) stages.push({ order: stages.length + 1, pageType: "Cart", title: cart.title, url: cart.url, action: checkoutAction ? `Click “${checkoutAction.text}”` : "Verify a populated cart and continue to checkout", ctaText: checkoutAction?.text || null, nextStepVisible: Boolean(checkoutAction), necessary: true, friction: cartEmpty ? "The crawled cart is empty." : !populatedCart ? "No selected product is visible in the cart." : checkoutAction ? null : "No verified Checkout action was found." });
  if (checkoutAction && checkout) { actions += 1; stages.push({ order: stages.length + 1, pageType: "Checkout", title: checkout.title, url: checkout.url, action: "Reach checkout", ctaText: null, nextStepVisible: true, necessary: true, friction: null }); }
  const route = [homepage, categoryPage, product, cart, checkout].filter((page): page is PageFacts => Boolean(page)).map((page) => page.normalizedUrl);
  return { businessModels: ["Ecommerce"], primaryOffer, primaryConversionType: "Checkout", primary: { status: complete ? "complete" : "incomplete", name: complete ? "Checkout journey" : "Incomplete journey", conversionType: "Checkout", startUrl: homepage.url, destinationUrl: complete ? checkout?.url || null : null, clicksToInterface: complete ? actions : null, additionalObservableActions: null, stages: stages.length ? stages : [{ order: 1, pageType: "Homepage", title: homepage.title, url: homepage.url, action: "Find a category or search path", ctaText: null, nextStepVisible: false, necessary: true, friction: "No ecommerce path was verified." }], shortestRoute: complete ? route : [], alternativeRoute: null, confidence: complete ? "High" : "Low", limitations: complete ? ["No purchase or payment was completed."] : [`Incomplete journey: ${missing.join("; ")}.`, "A directly requested cart or checkout URL is never treated as a valid empty-cart journey."] }, secondary: [] };
}

function buildGeneralJourney(pages: PageFacts[], homepage: PageFacts, primaryOffer: string, model: CommercialModel): JourneyAnalysis {
  const target = pages.find((page) => page.forms.some((form) => form.isConversion) || page.clickables.some((item) => COMMERCIAL_ACTION.test(item.text)));
  const pageMap = new Map(pages.map((page) => [page.normalizedUrl, page]));
  const queue: string[][] = [[homepage.normalizedUrl]];
  const visited = new Set([homepage.normalizedUrl]);
  let route: string[] | null = target?.normalizedUrl === homepage.normalizedUrl ? [homepage.normalizedUrl] : null;
  while (!route && queue.length && target) {
    const current = queue.shift()!;
    const page = pageMap.get(current[current.length - 1]);
    for (const link of page?.normalizedLinks || []) {
      if (!pageMap.has(link) || visited.has(link)) continue;
      const next = [...current, link];
      if (link === target.normalizedUrl) { route = next; break; }
      visited.add(link); queue.push(next);
    }
  }
  const stages = (route || [homepage.normalizedUrl]).map((url, index, all): JourneyStage => { const page = pageMap.get(url) || homepage; const next = all[index + 1] ? pageMap.get(all[index + 1]) : null; const action = next ? linkedAction(page, next) : null; return { order: index + 1, pageType: pageType(page, homepage), title: page.title, url: page.url, action: action ? `Click “${action.text}”` : "Reach the primary conversion interface", ctaText: action?.text || null, nextStepVisible: Boolean(action) || index === all.length - 1, necessary: true, friction: null }; });
  const conversionType: ConversionType = model === "booking" ? "Appointment booking" : model === "software" ? "Signup or subscription" : target?.forms.some((form) => form.isConversion) ? "Lead form" : target ? "Application" : "No clear conversion";
  return { businessModels: publicBusinessModels(model, pages.map((page) => page.bodyText).join(" ")), primaryOffer, primaryConversionType: conversionType, primary: { status: route ? "complete" : "incomplete", name: route ? "Primary conversion journey" : "Incomplete journey", conversionType, startUrl: homepage.url, destinationUrl: route ? target?.url || null : null, clicksToInterface: route ? Math.max(0, route.length - 1) : null, additionalObservableActions: null, stages, shortestRoute: route || [], alternativeRoute: null, confidence: route ? confidenceFor(pages.length, route.length) : "Low", limitations: route ? ["No form, booking or account action was submitted."] : ["No complete route to a verified conversion interface was found."] }, secondary: [] };
}

function ctaCategory(homepage: PageFacts, pages: PageFacts[], model: CommercialModel) {
  if (model === "ecommerce" || model === "marketplace") {
    const typed = pages.map((page) => ({ page, type: pageType(page, homepage) }));
    const categoryPage = typed.find((item) => item.type === "Category")?.page;
    const product = typed.find((item) => item.type === "Product")?.page;
    const cart = typed.find((item) => item.type === "Cart")?.page;
    const checkout = typed.find((item) => item.type === "Checkout")?.page;
    const actions = [categoryPage && linkedAction(homepage, categoryPage), categoryPage && product && linkedAction(categoryPage, product), product?.clickables.find((item) => ADD_TO_CART.test(item.text)), product && cart && (linkedAction(product, cart) || linkedAction(homepage, cart)), cart && checkout && cart.clickables.find((item) => CHECKOUT_ACTION.test(item.text) && item.href && normalizePageUrl(item.href, cart.url) === checkout.normalizedUrl)];
    const labels = ["product discovery", "product selection", "Add to cart", "Cart", "Checkout"];
    const present = actions.filter(Boolean).length;
    const missing = labels.filter((_, index) => !actions[index]);
    return category("cta-clarity", "CTA Clarity", Math.round((present / 5) * 100), confidenceFor(pages.length, present), missing.length ? `${present} of 5 required ecommerce actions are explicit and linked.` : "Product discovery, product selection, Add to cart, Cart and Checkout are explicit and linked.", actions.map((action, index) => ({ statement: action ? `${labels[index]}: “${action.text}”.` : `${labels[index]} was not verified.`, pageLabel: labels[index], url: index === 0 ? homepage.url : index <= 2 ? categoryPage?.url || homepage.url : cart?.url || homepage.url })), missing.length ? `Make the ${missing[0]} action explicit and link it to the next journey stage.` : "Keep all five purchase actions explicit and consistent.");
  }
  const commercial = pages.flatMap((page) => page.clickables.map((item) => ({ page, item }))).filter(({ item }) => COMMERCIAL_ACTION.test(item.text));
  const generic = homepage.clickables.filter((item) => GENERIC_ACTION.test(item.text));
  const score = commercial.length >= 2 ? 90 : commercial.length === 1 ? 70 : generic.length ? 35 : 10;
  return category("cta-clarity", "CTA Clarity", score, confidenceFor(pages.length, commercial.length + generic.length), commercial.length ? "The representative journey contains an explicit commercial action." : "The representative journey does not expose a specific commercial action.", [{ statement: commercial.length ? `Explicit actions: ${commercial.slice(0, 4).map(({ item }) => `“${item.text}”`).join(", ")}.` : generic.length ? `Only generic actions: ${generic.map((item) => `“${item.text}”`).join(", ")}.` : "No explicit commercial action was detected.", pageLabel: "Representative journey", url: homepage.url }], commercial.length ? "Keep one primary action consistent across the journey." : "Use one specific action that describes the next customer step.");
}

function journeyCategory(homepage: PageFacts, journey: JourneyAnalysis) {
  const complete = journey.primary.status === "complete";
  const actions = journey.primary.clicksToInterface;
  const ecommerce = journey.businessModels.includes("Ecommerce");
  const score = complete ? actions !== null && actions <= (ecommerce ? 4 : 1) ? 90 : actions !== null && actions <= (ecommerce ? 5 : 2) ? 70 : 45 : 10;
  return category("customer-journey-path", "Customer Journey Path", score, complete ? "High" : "Low", complete ? `The complete ${ecommerce ? "purchase" : "conversion"} route is verified in ${actions} required action${actions === 1 ? "" : "s"}.` : "Incomplete journey: the full route could not be verified from first-party links, controls and page states.", [{ statement: complete ? ecommerce ? `Verified route: Homepage → category/search → product → Add to cart → cart → checkout (${actions} required actions).` : `Verified route contains ${actions} required action${actions === 1 ? "" : "s"}.` : journey.primary.limitations[0], pageLabel: complete ? "Verified journey" : "Incomplete journey", url: homepage.url }], complete ? "Keep the verified route available and clearly labelled." : ecommerce ? "Expose and verify every stage from product discovery through checkout." : "Expose one complete route to the primary conversion interface.");
}

function finding(categoryItem: ReadinessCategory, homepage: PageFacts, rank: number): Gap {
  return { id: categoryItem.id, rank, title: categoryItem.label, summary: categoryItem.explanation, severity: severityFor(categoryItem.score), score: categoryItem.score, confidence: categoryItem.confidence, evidence: categoryItem.evidence.length ? categoryItem.evidence : [{ statement: categoryItem.explanation, pageLabel: "Crawl evidence", url: homepage.url }], nextAction: categoryItem.recommendation || "Improve this journey stage." };
}

function scoreLabel(score: number | null) {
  if (score === null) return "Insufficient data";
  if (score >= 80) return "Strong foundation";
  if (score >= 65) return "Nearly conversion-ready";
  if (score >= 50) return "Room to convert";
  return "Leaking demand";
}

export function analyzeCrawl(crawledPages: CrawlPage[], analyzedUrl: string, processingMs: number): AnalysisResult {
  const pages = buildFacts(crawledPages, analyzedUrl);
  const homepage = findHomepage(pages, analyzedUrl);
  if (!homepage) throw new Error("A homepage could not be identified in the crawl results.");
  const model = classifyCommercialModel(pages);
  const primaryOffer = inferPrimaryOffer(homepage, pages, model);
  const market = inferMarket(pages, model);
  const journey = model === "ecommerce" || model === "marketplace" ? buildEcommerceJourney(pages, homepage, primaryOffer) : buildGeneralJourney(pages, homepage, primaryOffer, model);
  const rawCategories = [offerCategory(homepage, pages, primaryOffer, market.targetCustomer), ctaCategory(homepage, pages, model), journeyCategory(homepage, journey)];
  const usefulPages = pages.filter((page) => page.statusCode < 400 && page.bodyText.length >= 80).length;
  const sufficient = usefulPages >= 3;
  const insufficient = `Insufficient data: only ${usefulPages} useful page${usefulPages === 1 ? " was" : "s were"} available; at least 3 are required.`;
  const categories = sufficient ? rawCategories : rawCategories.map((item) => ({ ...item, score: null, confidence: "Low" as const, explanation: insufficient }));
  const score = sufficient ? Math.round(categories.reduce((sum, item) => sum + (item.score || 0) * item.weight, 0) / 100) : null;
  const incompleteEcommerce = journey.businessModels.includes("Ecommerce") && journey.primary.status === "incomplete";
  const companyName = inferCompanyName(homepage);
  const internalLinks = new Set(pages.flatMap((page) => page.normalizedLinks));
  const confidence = sufficient ? confidenceFor(usefulPages, 3) : "Low";
  return {
    id: crypto.randomUUID(), mode: "live", url: analyzedUrl, companyName, primaryService: primaryOffer, score, scoreLabel: incompleteEcommerce && score !== null ? "Incomplete journey" : scoreLabel(score),
    readiness: { status: sufficient ? "scored" : "insufficient-data", score, assessedWeight: sufficient ? 100 : 0, minimumWeight: 100, formula: "Σ(category score × category weight) ÷ 100", categories },
    confidence, analyzedAt: new Date().toISOString(), summary: sufficient ? `Representative journey score: ${score}/100 across the three fixed findings.` : insufficient,
    overview: { score, status: score === null ? "Insufficient data" : incompleteEcommerce ? "Needs attention" : score >= 80 ? "Strong" : score >= 60 ? "Mixed" : "Needs attention", explanation: score === null ? insufficient : incompleteEcommerce ? "The purchase journey could not be verified from discovery through checkout." : "The score summarizes the same three deterministic journey findings.", businessModel: journey.businessModels[0], primaryConversion: journey.primaryConversionType, estimatedClicks: journey.primary.clicksToInterface },
    gaps: categories.map((item, index) => finding(item, homepage, index + 1)),
    stats: { pagesCrawled: pages.length, internalLinks: internalLinks.size, actionsFound: pages.reduce((sum, page) => sum + page.clickables.length, 0), conversionPathSteps: journey.primary.clicksToInterface, processingMs },
    market,
    competitors: { status: "skipped", label: "Likely public search competitors", query: `${primaryOffer} ${market.geography} ${market.targetCustomer}`.replace(/\s+/g, " ").trim(), geography: market.geography, targetCustomer: market.targetCustomer, entity: { companyName, domain: new URL(analyzedUrl).hostname.replace(/^www\./, ""), industry: primaryOffer, businessModel: "other", offerings: [primaryOffer], geography: market.geography, targetCustomer: market.targetCustomer, confidence, method: "deterministic" }, note: "Competitor discovery was not run for this result.", competitors: [], rejected: [] },
    journey,
    pages: pages.map((page) => ({ title: page.title, url: page.url, type: pageType(page, homepage), statusCode: page.statusCode })),
    llmEnhanced: false,
  };
}
