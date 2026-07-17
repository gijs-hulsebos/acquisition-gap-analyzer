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
import { canonicalSiteUrl, normalizePageUrl } from "./url";

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

function extractMarkdownClickables(markdown: string): Clickable[] {
  const items: Clickable[] = [];
  const pattern = /\[([^\]]+)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown))) {
    const text = cleanText(match[1].replace(/!\[|[*_`]/g, ""));
    if (!text || text.length > 90 || match[0].startsWith("!")) continue;
    items.push({ text, href: match[2], element: "link" });
  }
  return items;
}

function uniqueClickables(items: Clickable[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.text.toLowerCase()}|${item.href || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  return pages.flatMap((page) => {
    const normalizedUrl = normalizePageUrl(page.url, analyzedUrl);
    if (!normalizedUrl || !canonicalSiteUrl(normalizedUrl, analyzedUrl)) return [];
    const clickables = uniqueClickables([...extractClickables(page.html), ...extractMarkdownClickables(page.markdown)]);
    const normalizedLinks = Array.from(new Set([...page.links, ...clickables.flatMap((item) => item.href ? [item.href] : [])]
      .map((link) => normalizePageUrl(link, page.url))
      .map((link) => link ? canonicalSiteUrl(link, analyzedUrl) : null)
      .filter((link): link is string => Boolean(link))));
    return [{
      ...page,
      normalizedUrl: canonicalSiteUrl(normalizedUrl, analyzedUrl)!,
      clickables,
      forms: extractForms(page.html),
      normalizedLinks,
      bodyText: cleanText(`${page.html}\n${page.markdown}`),
      h1: cleanText(page.html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || page.markdown.match(/^#\s+(.+)$/m)?.[1] || ""),
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
  if (!ADD_TO_CART.test(page.bodyText) && (priceCount(page) >= 2 || productStructureCount(page) >= 2)) return "Category";
  if (/\/(collections?|collecties?|categories?|categorie|catalogus|shop|winkel|assortiment)(\/|$)/i.test(path)) return "Category";
  if (/\/(products?|product|p|artikel|item)\//i.test(path) || ADD_TO_CART.test(page.bodyText)) return "Product";
  if (/\/(pricing|prijzen|tarieven|abonnementen)(\/|$)/i.test(path)) return "Pricing";
  if (/\/(diensten?|services?|oplossingen?|solutions?)(\/|$)/i.test(path) || /\b(service|dienst|oplossing)\b/i.test(text)) return "Service";
  if (page.forms.some((form) => form.isConversion)) return "Other";
  return "Other";
}

function linkedAction(from: PageFacts, to: PageFacts) {
  return from.clickables.find((item) => item.href && canonicalSiteUrl(item.href, from.url) === canonicalSiteUrl(to.normalizedUrl, from.url)) || null;
}

function hasSearchControl(page: PageFacts) {
  return /<(form|input)\b[^>]*(search|zoeken?|zoekterm|query|searchbox)|placeholder\s*=\s*["'][^"']*(zoek|search)/i.test(page.html)
    || /\b(waar ben je naar op zoek|zoek producten|search products?)\b/i.test(page.markdown);
}

function priceCount(page: PageFacts) {
  return (page.bodyText.match(/(?:€|eur\s*)\s*\d{1,5}(?:[.,]\d{2})?|\b\d{1,4}[,.]\d{2}\b/gi) || []).length;
}

function productStructureCount(page: PageFacts) {
  const markupCount = (page.html.match(/product-(?:card|item|tile)|schema\.org\/Product|"@type"\s*:\s*"Product"/gi) || []).length;
  const pricedLinks = page.clickables.filter((item) => /(?:€|\b\d{1,4}[,.]\d{2}\b)/.test(item.text)).length;
  return Math.max(markupCount, pricedLinks, priceCount(page) >= 2 ? 2 : 0);
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
  const ecommerceBusinessOnly = model === "ecommerce" && /\b(alleen zakelijk|uitsluitend voor bedrijven|groothandel|wholesale|b2b webshop)\b/i.test(text);
  const targetCustomer = model === "ecommerce" ? ecommerceBusinessOnly ? "bedrijven" : "particulieren" : business && consumer ? "bedrijven en particulieren" : business ? "bedrijven" : consumer ? "particulieren" : "Nederlandse klanten";
  return { geography: /\b(heel|door heel) nederland\b/i.test(text) ? "Nederland" : city || "Nederland", targetCustomer };
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
  const model = classifyCommercialModel(pages);
  const homepageText = `${homepage.h1} ${homepage.description} ${homepage.bodyText.slice(0, 5000)}`;
  const linkedLabels = homepage.clickables.map((item) => item.text).filter((text) => text.length >= 3).slice(0, 30);
  const searchVisible = hasSearchControl(homepage);
  const productSignals = productStructureCount(homepage);
  const prices = priceCount(homepage);
  const browseAction = homepage.clickables.find((item) => /\b(assortiment|collectie|categorie|producten|shop|winkel|bekijk alles|ontdek)\b/i.test(item.text));
  const offerTokens = meaningfulTokens(`${primaryOffer} ${linkedLabels.join(" ")}`).slice(0, 10);
  const headingSpecific = homepage.h1.length >= 8 && !/^(home|homepage|welkom|welcome|dille\s*&\s*kamille)$/i.test(homepage.h1) && offerTokens.some((token) => homepage.h1.toLowerCase().includes(token));

  if (model === "ecommerce" || model === "marketplace") {
    const assortmentVisible = productSignals >= 2 || prices >= 2 || linkedLabels.filter((label) => /\b(bekijk|shop|collectie|assortiment|categorie|product)\b/i.test(label)).length >= 2;
    const shoppingIntent = Boolean(browseAction || searchVisible || productSignals >= 2);
    const score = (headingSpecific ? 35 : assortmentVisible ? 30 : 10) + (assortmentVisible ? 35 : 0) + (shoppingIntent ? 30 : 0);
    const evidence: Evidence[] = [
      { statement: headingSpecific ? `The landing-page heading names the offer: “${homepage.h1}”.` : assortmentVisible ? `The landing page exposes an assortment through ${productSignals || prices} product/price signals and labelled category or product links.` : "The landing page does not expose enough product or category evidence to identify the assortment.", pageLabel: "Landing-page offer", url: homepage.url },
      { statement: browseAction ? `The landing page uses the discovery action “${browseAction.text}”.` : searchVisible ? "A product-search control is visible on the landing page." : "No clear assortment, category or search action was detected on the landing page.", pageLabel: "Shopping intent", url: homepage.url },
    ];
    const explanation = assortmentVisible && shoppingIntent
      ? "The landing page makes it clear that visitors can browse and buy products."
      : assortmentVisible
        ? "Products are visible, but the next shopping action is not explicit enough."
        : "The landing page does not make the sellable assortment immediately clear.";
    const recommendation = !assortmentVisible ? `Show representative categories or products for ${primaryOffer} on the landing page.` : !shoppingIntent ? "Add one explicit Browse products, Search or Shop action beside the assortment." : "Keep the assortment and shopping action visible together.";
    return category("offer-clarity", "Offer Clarity", score, confidenceFor(pages.length, evidence.length), explanation, evidence, recommendation);
  }

  const whatClear = headingSpecific || offerTokens.filter((token) => homepageText.toLowerCase().includes(token)).length >= 2;
  const audience = firstSnippet(homepageText, /\b(voor (?:bedrijven|ondernemers|organisaties|professionals|particulieren|consumenten|woningeigenaren|gezinnen)|b2b|b2c|zakelijk|thuis)\b/i);
  const commercial = homepage.clickables.find((item) => COMMERCIAL_ACTION.test(item.text));
  const score = (whatClear ? 55 : 15) + (audience ? 20 : 0) + (commercial ? 25 : 0);
  return category("offer-clarity", "Offer Clarity", score, confidenceFor(pages.length, [whatClear, audience, commercial].filter(Boolean).length), whatClear && commercial ? "The landing page explains the offer and exposes a concrete next step." : "The landing page does not make both the offer and conversion step immediately clear.", [
    { statement: whatClear ? `Landing-page offer evidence: “${homepage.h1 || primaryOffer}”.` : "The landing-page heading and opening copy do not clearly name the offer.", pageLabel: "Landing-page offer", url: homepage.url },
    { statement: commercial ? `Primary action: “${commercial.text}”.` : "No explicit commercial action was detected on the landing page.", pageLabel: "Conversion intent", url: homepage.url },
  ], !whatClear ? `Name ${primaryOffer} directly in the landing-page heading.` : !commercial ? "Add one explicit action describing the next customer step." : `Keep the offer and action clear for ${targetCustomer}.`);
}

function buildEcommerceJourney(pages: PageFacts[], homepage: PageFacts, primaryOffer: string): JourneyAnalysis {
  const typed = pages.map((page) => ({ page, type: pageType(page, homepage) }));
  const categoryPage = typed.find((item) => item.type === "Category" && linkedAction(homepage, item.page))?.page || null;
  const directProduct = typed.find((item) => item.type === "Product" && linkedAction(homepage, item.page))?.page || null;
  const categoryProduct = categoryPage ? typed.find((item) => item.type === "Product" && linkedAction(categoryPage, item.page))?.page || null : null;
  const product = directProduct || categoryProduct;
  const listingAdd = categoryPage?.clickables.find((item) => ADD_TO_CART.test(item.text)) || null;
  const productAdd = product?.clickables.find((item) => ADD_TO_CART.test(item.text)) || null;
  const add = directProduct ? productAdd : listingAdd || productAdd;
  const discoveryPage = directProduct || categoryPage;
  const discoveryAction = discoveryPage ? linkedAction(homepage, discoveryPage) : null;
  const selectionAction = !directProduct && categoryPage && categoryProduct && !listingAdd ? linkedAction(categoryPage, categoryProduct) : null;
  const missing = [!discoveryPage || !discoveryAction ? "a linked category, search result or product from the landing page" : null, !add ? "a verified Add to cart action" : null].filter((item): item is string => Boolean(item));
  const complete = missing.length === 0;
  const steps = complete ? selectionAction ? 4 : 3 : null;
  const stages: JourneyStage[] = [];
  if (discoveryPage && discoveryAction) stages.push({ order: 1, pageType: "Homepage", title: homepage.title, url: homepage.url, action: `Click “${discoveryAction.text}”`, ctaText: discoveryAction.text, nextStepVisible: true, necessary: true, friction: null });
  if (categoryPage && selectionAction && product) stages.push({ order: 2, pageType: "Category", title: categoryPage.title, url: categoryPage.url, action: `Click “${selectionAction.text}”`, ctaText: selectionAction.text, nextStepVisible: true, necessary: true, friction: null });
  const addPage = listingAdd && categoryPage ? categoryPage : product;
  if (add && addPage) stages.push({ order: stages.length + 1, pageType: pageType(addPage, homepage), title: addPage.title, url: addPage.url, action: `Click “${add.text}”`, ctaText: add.text, nextStepVisible: true, necessary: true, friction: null });
  if (complete && addPage) stages.push({ order: stages.length + 1, pageType: "Conversion", title: "Add to cart conversion", url: addPage.url, action: "Product added to cart", ctaText: add!.text, nextStepVisible: true, necessary: true, friction: null });
  const route = [homepage, ...(categoryPage && !directProduct ? [categoryPage] : []), ...(product ? [product] : [])].map((page) => page.normalizedUrl);
  return { businessModels: ["Ecommerce"], primaryOffer, primaryConversionType: "Add to cart", primary: { status: complete ? "complete" : "incomplete", name: complete ? "Add to cart journey" : "Incomplete journey", conversionType: "Add to cart", startUrl: homepage.url, destinationUrl: complete ? addPage?.url || null : null, clicksToInterface: steps, additionalObservableActions: null, stages: stages.length ? stages : [{ order: 1, pageType: "Homepage", title: homepage.title, url: homepage.url, action: "Find a linked category, search result or product", ctaText: null, nextStepVisible: false, necessary: true, friction: "No ecommerce discovery path was verified." }], shortestRoute: complete ? route : [], alternativeRoute: null, confidence: complete ? "High" : "Low", limitations: complete ? ["The Add to cart control is verified from public page evidence; no purchase was completed."] : [`Incomplete journey: ${missing.join("; ")}.`, "A direct cart or checkout URL is never counted as a customer journey."] }, secondary: [] };
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
    const categoryPage = typed.find((item) => item.type === "Category" && linkedAction(homepage, item.page))?.page;
    const directProduct = typed.find((item) => item.type === "Product" && linkedAction(homepage, item.page))?.page;
    const categoryProduct = categoryPage ? typed.find((item) => item.type === "Product" && linkedAction(categoryPage, item.page))?.page : undefined;
    const discoveryTarget = directProduct || categoryPage;
    const discovery = discoveryTarget ? linkedAction(homepage, discoveryTarget) : null;
    const search = hasSearchControl(homepage);
    const selection = categoryPage && categoryProduct ? linkedAction(categoryPage, categoryProduct) : null;
    const listingAdd = categoryPage?.clickables.find((item) => ADD_TO_CART.test(item.text));
    const product = directProduct || categoryProduct;
    const add = listingAdd || product?.clickables.find((item) => ADD_TO_CART.test(item.text));
    const discoveryClear = Boolean(discovery || search);
    const selectionNeeded = Boolean(!directProduct && categoryPage && categoryProduct && !listingAdd);
    const selectionClear = !selectionNeeded || Boolean(selection);
    const addClear = Boolean(add);
    const score = (discoveryClear ? 40 : 0) + (selectionClear ? 20 : 0) + (addClear ? 40 : 0);
    const evidence: Evidence[] = [
      { statement: discovery ? `Landing-page discovery action: “${discovery.text}”.` : search ? "A product-search control is visible on the landing page." : "No linked category, search or product-discovery action was verified on the landing page.", pageLabel: "Product discovery", url: homepage.url },
      ...(selectionNeeded ? [{ statement: selection ? `Product-selection action: “${selection.text}”.` : "No product-selection action was verified from the selected category.", pageLabel: "Product selection", url: categoryPage?.url || homepage.url }] : []),
      { statement: add ? `Conversion action: “${add.text}”.` : "No Add to cart action was verified on the selected listing or product page.", pageLabel: "Add to cart", url: listingAdd ? categoryPage?.url || homepage.url : product?.url || homepage.url },
    ];
    const explanation = discoveryClear && selectionClear && addClear
      ? `The next shopping actions are clear: ${[discovery?.text || (search ? "Search" : null), selection?.text, add?.text].filter(Boolean).join(" → ")}.`
      : `The shopping CTA chain is incomplete because ${[!discoveryClear ? "product discovery" : null, !selectionClear ? "product selection" : null, !addClear ? "Add to cart" : null].filter(Boolean).join(" and ")} could not be verified.`;
    const recommendation = !discoveryClear ? "Expose a labelled category, search or product action on the landing page." : !selectionClear ? "Use a clear product-selection label inside the category results." : !addClear ? "Expose an explicit Add to cart action on the selected listing or product page." : "Keep the discovery and Add to cart labels consistent.";
    return category("cta-clarity", "CTA Clarity", score, confidenceFor(pages.length, evidence.length), explanation, evidence, recommendation);
  }
  const commercial = pages.flatMap((page) => page.clickables.map((item) => ({ page, item }))).filter(({ item }) => COMMERCIAL_ACTION.test(item.text));
  const generic = homepage.clickables.filter((item) => GENERIC_ACTION.test(item.text));
  const score = commercial.length >= 2 ? 90 : commercial.length === 1 ? 70 : generic.length ? 35 : 10;
  return category("cta-clarity", "CTA Clarity", score, confidenceFor(pages.length, commercial.length + generic.length), commercial.length ? "The representative journey contains an explicit commercial action." : "The representative journey does not expose a specific commercial action.", [{ statement: commercial.length ? `Explicit actions: ${commercial.slice(0, 4).map(({ item }) => `“${item.text}”`).join(", ")}.` : generic.length ? `Only generic actions: ${generic.map((item) => `“${item.text}”`).join(", ")}.` : "No explicit commercial action was detected.", pageLabel: "Representative journey", url: homepage.url }], commercial.length ? "Keep one primary action consistent across the journey." : "Use one specific action that describes the next customer step.");
}

function journeyCategory(homepage: PageFacts, journey: JourneyAnalysis) {
  const complete = journey.primary.status === "complete";
  const steps = journey.primary.clicksToInterface;
  const ecommerce = journey.businessModels.includes("Ecommerce");
  const score = complete ? steps !== null && steps <= (ecommerce ? 3 : 1) ? 95 : steps !== null && steps <= (ecommerce ? 4 : 2) ? 80 : 55 : 10;
  return category("customer-journey-path", "Customer Journey Path", score, complete ? "High" : "Low", complete ? `The verified ${ecommerce ? "Add to cart" : "conversion"} path takes ${steps} step${steps === 1 ? "" : "s"}.` : "Incomplete journey: the full route could not be verified from first-party links and controls.", [{ statement: complete ? ecommerce ? `Verified path: ${journey.primary.stages.map((stage) => stage.pageType === "Conversion" ? "Add to cart" : stage.pageType).join(" → ")} (${steps} steps).` : `Verified route contains ${steps} step${steps === 1 ? "" : "s"}.` : journey.primary.limitations[0], pageLabel: complete ? "Verified journey" : "Incomplete journey", url: homepage.url }], complete ? "Keep the shortest verified path visible." : ecommerce ? "Expose one linked route from the landing page to an Add to cart action." : "Expose one complete route to the primary conversion interface.");
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
    overview: { score, status: score === null ? "Insufficient data" : incompleteEcommerce ? "Needs attention" : score >= 80 ? "Strong" : score >= 60 ? "Mixed" : "Needs attention", explanation: score === null ? insufficient : incompleteEcommerce ? "The ecommerce path could not be verified from landing-page discovery to Add to cart." : "The score summarizes the same three deterministic journey findings.", businessModel: journey.businessModels[0], primaryConversion: journey.primaryConversionType, estimatedClicks: journey.primary.clicksToInterface },
    gaps: categories.map((item, index) => finding(item, homepage, index + 1)),
    stats: { pagesCrawled: pages.length, internalLinks: internalLinks.size, actionsFound: pages.reduce((sum, page) => sum + page.clickables.length, 0), conversionPathSteps: journey.primary.clicksToInterface, processingMs },
    market,
    competitors: { status: "skipped", label: "Likely public search competitors", query: `${primaryOffer} ${market.geography} ${market.targetCustomer}`.replace(/\s+/g, " ").trim(), geography: market.geography, targetCustomer: market.targetCustomer, entity: { companyName, domain: new URL(analyzedUrl).hostname.replace(/^www\./, ""), industry: primaryOffer, businessModel: "other", offerings: [primaryOffer], geography: market.geography, targetCustomer: market.targetCustomer, confidence, method: "deterministic" }, note: "Competitor discovery was not run for this result.", competitors: [], rejected: [] },
    journey,
    pages: pages.map((page) => ({ title: page.title, url: page.url, type: pageType(page, homepage), statusCode: page.statusCode })),
    llmEnhanced: false,
  };
}
