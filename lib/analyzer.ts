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

const WEIGHTS = { "offer-clarity": 35, "purchase-confidence": 30, "customer-journey-path": 35 } as const;
const ADD_TO_CART = /\b(add to (?:cart|bag|basket)|in (?:de )?(?:winkelmand(?:je)?|winkelwagen(?:tje)?|mandje)|voeg(?:en)? toe aan (?:de )?(?:winkelmand(?:je)?|winkelwagen(?:tje)?|mandje)|toevoegen aan (?:de )?(?:winkelmand(?:je)?|winkelwagen(?:tje)?|mandje)|bestel nu|buy now)\b/i;
const COMMERCIAL_ACTION = /\b(start|aanvragen|plan|boek|demo|registreer|inschrijven|bestel|koop|subscribe|sign up|get started|book|schedule|request|apply)\b/i;
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
    const text = cleanText(match[3]) || cleanText(getAttribute(match[2], "aria-label") || getAttribute(match[2], "title") || getAttribute(match[2], "value") || "");
    if (!text || text.length > 90) continue;
    items.push({ text, href: getAttribute(match[2], "href") || getAttribute(match[2], "formaction"), element: match[1].toLowerCase() === "a" ? "link" : "button" });
  }
  for (const input of html.matchAll(/<input\b([^>]*)>/gi)) {
    const type = getAttribute(input[1], "type") || "";
    if (!/^(?:submit|button|image)$/i.test(type)) continue;
    const text = cleanText(getAttribute(input[1], "value") || getAttribute(input[1], "aria-label") || getAttribute(input[1], "title") || "");
    if (!text || text.length > 90) continue;
    items.push({ text, href: getAttribute(input[1], "formaction"), element: "button" });
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
  if ((/\.html$/i.test(path) && priceCount(page) >= 1 && page.h1.length >= 3) || /schema\.org\/Product|"@type"\s*:\s*"Product"|itemprop\s*=\s*["'](?:sku|productID|price)/i.test(page.html)) return "Product";
  if (!hasAddToCart(page) && (priceCount(page) >= 2 || productStructureCount(page) >= 2)) return "Category";
  if (/\/(collections?|collecties?|categories?|categorie|catalogus|shop|winkel|assortiment)(\/|$)/i.test(path)) return "Category";
  if (/\/(products?|product|p|artikel|item)\//i.test(path) || hasAddToCart(page)) return "Product";
  if (priceCount(page) === 1 && page.h1.length >= 3 && page.bodyText.length >= 80) return "Product";
  if (/\/(pricing|prijzen|tarieven|abonnementen)(\/|$)/i.test(path)) return "Pricing";
  if (/\/(diensten?|services?|oplossingen?|solutions?)(\/|$)/i.test(path) || /\b(service|dienst|oplossing)\b/i.test(text)) return "Service";
  if (page.forms.some((form) => form.isConversion)) return "Other";
  return "Other";
}

function hasAddToCart(page: PageFacts) {
  return ADD_TO_CART.test(page.bodyText)
    || page.clickables.some((item) => ADD_TO_CART.test(item.text))
    || ADD_TO_CART.test(page.html.replace(/[\s_-]+/g, " "));
}

function linkedAction(from: PageFacts, to: PageFacts) {
  return from.clickables.find((item) => item.href && canonicalSiteUrl(item.href, from.url) === canonicalSiteUrl(to.normalizedUrl, from.url))
    || (from.normalizedLinks.includes(to.normalizedUrl) ? { text: to.h1 || to.title, href: to.url, element: "link" as const } : null);
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

function category(id: ReadinessCategory["id"], label: string, score: number | null, confidence: Confidence, explanation: string, evidence: Evidence[], recommendation: string, checklist: ReadinessCategory["checklist"]): ReadinessCategory {
  return { id, label, score, weight: WEIGHTS[id], confidence, explanation, evidence, recommendation, checklist };
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
    return category("offer-clarity", "Offer Clarity", score, confidenceFor(pages.length, evidence.length), explanation, evidence, recommendation, [
      { label: "The offer is explicit in the main heading", status: headingSpecific ? "met" : assortmentVisible ? "partial" : "missing", detail: headingSpecific ? `Heading: “${homepage.h1}”` : assortmentVisible ? "The assortment is visible, but the heading is less specific." : "No explicit offer was found in the heading." },
      { label: "Representative products or categories are visible", status: assortmentVisible ? "met" : "missing", detail: assortmentVisible ? "Product, price or category signals were detected." : "No representative assortment was detected." },
      { label: "A clear browse, shop or search action is available", status: shoppingIntent ? "met" : "missing", detail: browseAction?.text || (searchVisible ? "Search control detected." : "No shopping action was detected.") },
    ]);
  }

  const whatClear = headingSpecific || offerTokens.filter((token) => homepageText.toLowerCase().includes(token)).length >= 2;
  const audience = firstSnippet(homepageText, /\b(voor (?:bedrijven|ondernemers|organisaties|professionals|particulieren|consumenten|woningeigenaren|gezinnen)|b2b|b2c|zakelijk|thuis)\b/i);
  const commercial = homepage.clickables.find((item) => COMMERCIAL_ACTION.test(item.text));
  const score = (whatClear ? 55 : 15) + (audience ? 20 : 0) + (commercial ? 25 : 0);
  return category("offer-clarity", "Offer Clarity", score, confidenceFor(pages.length, [whatClear, audience, commercial].filter(Boolean).length), whatClear && commercial ? "The landing page explains the offer and exposes a concrete next step." : "The landing page does not make both the offer and conversion step immediately clear.", [
    { statement: whatClear ? `Landing-page offer evidence: “${homepage.h1 || primaryOffer}”.` : "The landing-page heading and opening copy do not clearly name the offer.", pageLabel: "Landing-page offer", url: homepage.url },
    { statement: commercial ? `Primary action: “${commercial.text}”.` : "No explicit commercial action was detected on the landing page.", pageLabel: "Conversion intent", url: homepage.url },
  ], !whatClear ? `Name ${primaryOffer} directly in the landing-page heading.` : !commercial ? "Add one explicit action describing the next customer step." : `Keep the offer and action clear for ${targetCustomer}.`, [
    { label: "The offer is immediately clear", status: whatClear ? "met" : "missing", detail: whatClear ? `Offer evidence: “${homepage.h1 || primaryOffer}”.` : "The opening copy does not clearly name the offer." },
    { label: "The intended customer is identified", status: audience ? "met" : "missing", detail: audience || "No explicit audience statement was detected." },
    { label: "A concrete commercial next step is visible", status: commercial ? "met" : "missing", detail: commercial?.text || "No commercial action was detected." },
  ]);
}

function buildEcommerceJourney(pages: PageFacts[], homepage: PageFacts, primaryOffer: string): JourneyAnalysis {
  const typed = pages.map((page) => ({ page, type: pageType(page, homepage) }));
  const categoryPage = typed.find((item) => item.type === "Category" && linkedAction(homepage, item.page))?.page || null;
  const directProduct = typed.find((item) => item.type === "Product" && linkedAction(homepage, item.page))?.page || null;
  const categoryProduct = categoryPage ? typed.find((item) => item.type === "Product" && linkedAction(categoryPage, item.page))?.page || null : null;
  const product = directProduct || categoryProduct;
  const homepageAdd = homepage.clickables.find((item) => ADD_TO_CART.test(item.text)) || null;
  const listingAdd = categoryPage?.clickables.find((item) => ADD_TO_CART.test(item.text)) || null;
  const productAdd = product?.clickables.find((item) => ADD_TO_CART.test(item.text)) || null;
  const add = homepageAdd || (directProduct ? productAdd : listingAdd || productAdd);
  const discoveryPage = directProduct || categoryPage;
  const discoveryAction = discoveryPage ? linkedAction(homepage, discoveryPage) : null;
  const selectionAction = !directProduct && categoryPage && categoryProduct && !listingAdd ? linkedAction(categoryPage, categoryProduct) : null;
  const cartPage = typed.find((item) => item.type === "Cart")?.page || null;
  const checkoutPage = typed.find((item) => item.type === "Checkout")?.page || null;
  const missing = homepageAdd ? [] : [!discoveryPage || !discoveryAction ? "a linked category, search result or product from the landing page" : null, !product && !listingAdd ? "a representative product or purchasable listing" : null].filter((item): item is string => Boolean(item));
  const complete = missing.length === 0;
  const stages: JourneyStage[] = [];
  if (!homepageAdd && discoveryPage && discoveryAction) stages.push({ order: 1, pageType: "Homepage", title: homepage.title, url: homepage.url, action: `Click “${discoveryAction.text}”`, ctaText: discoveryAction.text, nextStepVisible: true, necessary: true, friction: null });
  if (!homepageAdd && categoryPage && selectionAction && product) stages.push({ order: stages.length + 1, pageType: "Category", title: categoryPage.title, url: categoryPage.url, action: `Click “${selectionAction.text}”`, ctaText: selectionAction.text, nextStepVisible: true, necessary: true, friction: null });
  const addPage = homepageAdd ? homepage : listingAdd && categoryPage ? categoryPage : product;
  if (add && addPage) stages.push({ order: stages.length + 1, pageType: pageType(addPage, homepage), title: addPage.title, url: addPage.url, action: `Click “${add.text}”`, ctaText: add.text, nextStepVisible: true, necessary: true, friction: null });
  if (!add && addPage) stages.push({ order: stages.length + 1, pageType: pageType(addPage, homepage), title: addPage.title, url: addPage.url, action: "Add the selected product to cart", ctaText: null, nextStepVisible: false, necessary: true, friction: "The product page was found, but Firecrawl did not capture the dynamic button label." });
  const steps = complete ? stages.length + 2 : null;
  const route = [homepage, ...(!homepageAdd && categoryPage && !directProduct ? [categoryPage] : []), ...(!homepageAdd && product ? [product] : [])].map((page) => page.normalizedUrl);
  return { businessModels: ["Ecommerce"], primaryOffer, primaryConversionType: "Checkout", primary: { status: complete ? "complete" : "incomplete", name: complete ? "Landing page to checkout" : "Incomplete journey", conversionType: "Checkout", startUrl: homepage.url, destinationUrl: checkoutPage?.url || cartPage?.url || addPage?.url || null, clicksToInterface: steps, additionalObservableActions: null, stages: stages.length ? [...stages, ...(complete ? [{ order: stages.length + 1, pageType: "Cart" as const, title: cartPage?.title || "Cart", url: cartPage?.url || addPage?.url || homepage.url, action: "Open cart", ctaText: null, nextStepVisible: Boolean(cartPage), necessary: true, friction: cartPage ? null : "Cart state inferred after Add to cart." }, { order: stages.length + 2, pageType: "Checkout" as const, title: checkoutPage?.title || "Checkout", url: checkoutPage?.url || cartPage?.url || addPage?.url || homepage.url, action: "Continue to checkout", ctaText: null, nextStepVisible: Boolean(checkoutPage), necessary: true, friction: checkoutPage ? null : "Checkout inferred from the required ecommerce flow." }] : [])] : [{ order: 1, pageType: "Homepage", title: homepage.title, url: homepage.url, action: "Find a linked category, search result or product", ctaText: null, nextStepVisible: false, necessary: true, friction: "No ecommerce discovery path was verified." }], shortestRoute: complete ? route : [], alternativeRoute: null, confidence: complete && cartPage && checkoutPage ? "High" : complete ? "Medium" : "Low", limitations: complete ? ["The estimate starts with an empty cart. Buttons are detected but not clicked, so post-click cart or checkout states may be inferred."] : [`Incomplete journey: ${missing.join("; ")}.`] }, secondary: [] };
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

function purchaseConfidenceCategory(homepage: PageFacts, pages: PageFacts[]) {
  const signals = [
    { label: "clear pricing", weight: 10, pattern: /(?:€|eur\s*)\s*\d{1,5}(?:[.,]\d{2})?|\b\d{1,4}[,.]\d{2}\b/i, recommendation: "Show clear pricing before visitors commit." },
    { label: "delivery information", weight: 15, pattern: /\b(delivery|shipping|dispatch|bezorg(?:ing|d)?|verzend(?:ing|kosten)?|levering|afhalen|ophalen)\b/i, recommendation: "State delivery costs and timing near the buying decision." },
    { label: "returns or refunds", weight: 15, pattern: /\b(returns?|return policy|refunds?|retour(?:neren|beleid)?|bedenktijd|terugbetaling)\b/i, recommendation: "Make the return or refund policy easy to find." },
    { label: "reviews or ratings", weight: 15, pattern: /\b(reviews?|ratings?|beoordeling(?:en)?|klantbeoordelingen?|sterren|stars?|testimonials?|klantverhalen)\b|\b\d(?:[.,]\d)?\s*(?:van|out of)\s*5\b/i, recommendation: "Add visible customer reviews or ratings." },
    { label: "payment reassurance", weight: 15, pattern: /\b(payment methods?|secure payment|veilig betalen|betaalmethoden?|iDEAL|visa|mastercard|paypal|klarna|apple pay)\b/i, recommendation: "Show accepted and secure payment methods before checkout." },
    { label: "customer support", weight: 10, pattern: /\b(customer service|customer support|klantenservice|helpdesk|contact opnemen|telefoon|phone|e-?mail)\b/i, recommendation: "Provide clear customer-service contact details." },
    { label: "guarantees or certification", weight: 10, pattern: /\b(guarantee|warranty|garantie|keurmerk|certificat(?:e|ion)|gecertificeerd|certified|thuiswinkel|ssl|secure checkout)\b/i, recommendation: "Add a relevant guarantee, certification or security signal." },
    { label: "availability", weight: 10, pattern: /\b(in stock|out of stock|availability|op voorraad|voorraad|beschikbaar|uitverkocht)\b/i, recommendation: "Make product or service availability explicit." },
  ];
  const detected = signals.flatMap((signal) => {
    const page = pages.find((candidate) => signal.pattern.test(candidate.bodyText));
    return page ? [{ ...signal, page }] : [];
  });
  const score = detected.reduce((total, signal) => total + signal.weight, 0);
  const evidence: Evidence[] = detected.slice(0, 4).map((signal) => ({
    statement: `Visible ${signal.label} was detected on “${signal.page.title}”.`,
    pageLabel: signal.label.replace(/\b\w/g, (letter) => letter.toUpperCase()),
    url: signal.page.url,
  }));
  if (!evidence.length) evidence.push({ statement: "No purchase-reassurance signals were detected in the representative pages.", pageLabel: "Purchase confidence", url: homepage.url });
  const missing = signals.filter((signal) => !detected.some((item) => item.label === signal.label));
  const explanation = detected.length
    ? `${detected.length} of ${signals.length} purchase-confidence signals were found: ${detected.map((signal) => signal.label).join(", ")}.`
    : "The representative pages contain little visible reassurance for a purchase decision.";
  return category("purchase-confidence", "Purchase Confidence", score, confidenceFor(pages.length, detected.length), explanation, evidence, missing[0]?.recommendation || "Keep purchase reassurance visible throughout the journey.", signals.map((signal) => {
    const match = detected.find((item) => item.label === signal.label);
    return { label: `${signal.label.replace(/^./, (letter) => letter.toUpperCase())} (${signal.weight}%)`, status: match ? "met" as const : "missing" as const, detail: match ? `Detected on “${match.page.title}”.` : signal.recommendation };
  }));
}

function journeyCategory(homepage: PageFacts, journey: JourneyAnalysis) {
  const complete = journey.primary.status === "complete";
  const steps = journey.primary.clicksToInterface;
  const ecommerce = journey.businessModels.includes("Ecommerce");
  const score = complete ? steps !== null && steps <= (ecommerce ? 3 : 1) ? 100 : steps !== null && steps <= (ecommerce ? 4 : 2) ? 95 : steps !== null && steps <= (ecommerce ? 5 : 3) ? 80 : 55 : 10;
  const hasAction = journey.primary.stages.some((stage) => Boolean(stage.ctaText) || stage.nextStepVisible);
  const hasDestination = journey.primary.destinationUrl !== null;
  const idealClicks = ecommerce ? 3 : 1;
  return category("customer-journey-path", "Customer Journey Path", score, journey.primary.confidence, complete ? `From an empty cart, the estimated landing-page-to-${ecommerce ? "checkout" : "conversion"} path takes ${steps} click${steps === 1 ? "" : "s"}.` : "Incomplete journey: product discovery or the primary conversion action could not be verified.", [{ statement: complete ? `Estimated path: ${journey.primary.stages.map((stage) => stage.pageType).join(" → ")} (${steps} clicks).` : journey.primary.limitations[0], pageLabel: complete ? "Customer journey" : "Incomplete journey", url: homepage.url }], complete ? "Keep the shortest route to checkout visible." : ecommerce ? "Link product discovery clearly to a product with Add to cart." : "Expose one complete route to the primary conversion interface.", [
    { label: "A complete route starts on the landing page", status: complete ? "met" : "missing", detail: complete ? "A representative route was mapped." : journey.primary.limitations[0] },
    { label: "The primary conversion action is detectable", status: hasAction ? "met" : "missing", detail: hasAction ? "A required next action was detected." : "No required next action was detected." },
    { label: `The ${ecommerce ? "cart and checkout" : "conversion destination"} can be mapped`, status: hasDestination ? "met" : "missing", detail: hasDestination ? "A destination page or state was identified." : "The destination could not be identified." },
    { label: `${idealClicks} click${idealClicks === 1 ? "" : "s"} or fewer to conversion`, status: complete && steps !== null && steps <= idealClicks ? "met" : complete ? "partial" : "missing", detail: steps === null ? "Click count is unavailable." : `${steps} clicks were estimated.` },
  ]);
}

function finding(categoryItem: ReadinessCategory, homepage: PageFacts, rank: number): Gap {
  return { id: categoryItem.id, rank, title: categoryItem.label, summary: categoryItem.explanation, severity: severityFor(categoryItem.score), score: categoryItem.score, confidence: categoryItem.confidence, evidence: categoryItem.evidence.length ? categoryItem.evidence : [{ statement: categoryItem.explanation, pageLabel: "Crawl evidence", url: homepage.url }], checklist: categoryItem.checklist, nextAction: categoryItem.recommendation || "Improve this journey stage." };
}

function scoreLabel(score: number | null) {
  if (score === null) return "Insufficient data";
  if (score >= 80) return "Strong foundation";
  if (score >= 65) return "Nearly conversion-ready";
  if (score >= 50) return "Room to convert";
  return "Leaking demand";
}

function improvementReport(gaps: Gap[]) {
  const ranked = [...gaps].filter((gap) => gap.score !== null).sort((a, b) => (b.score || 0) - (a.score || 0));
  const strengths = ranked.filter((gap) => (gap.score || 0) >= 70).slice(0, 2);
  const improvements = [...ranked].reverse().filter((gap) => (gap.score || 0) < 85).slice(0, 2);
  return {
    whatIsDoneWell: (strengths.length ? strengths : ranked.slice(0, 1)).map((gap) => `${gap.title}: ${gap.summary}`),
    whatCouldBeBetter: (improvements.length ? improvements : gaps.slice(0, 1)).map((gap) => `${gap.title}: ${gap.nextAction}`),
    competitorComparison: [],
  };
}

export function analyzeCrawl(crawledPages: CrawlPage[], analyzedUrl: string, processingMs: number): AnalysisResult {
  const pages = buildFacts(crawledPages, analyzedUrl);
  const homepage = findHomepage(pages, analyzedUrl);
  if (!homepage) throw new Error("A homepage could not be identified in the crawl results.");
  const model = classifyCommercialModel(pages);
  const primaryOffer = inferPrimaryOffer(homepage, pages, model);
  const market = inferMarket(pages, model);
  const journey = model === "ecommerce" || model === "marketplace" ? buildEcommerceJourney(pages, homepage, primaryOffer) : buildGeneralJourney(pages, homepage, primaryOffer, model);
  const rawCategories = [offerCategory(homepage, pages, primaryOffer, market.targetCustomer), purchaseConfidenceCategory(homepage, pages), journeyCategory(homepage, journey)];
  const usefulPages = pages.filter((page) => page.statusCode < 400 && page.bodyText.length >= 80).length;
  const sufficient = usefulPages >= 2;
  const insufficient = `Insufficient data: only ${usefulPages} useful page${usefulPages === 1 ? " was" : "s were"} available; at least 2 are required.`;
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
    overview: { score, status: score === null ? "Insufficient data" : incompleteEcommerce ? "Needs attention" : score >= 80 ? "Strong" : score >= 60 ? "Mixed" : "Needs attention", explanation: score === null ? insufficient : incompleteEcommerce ? "The ecommerce path could not be estimated from landing-page discovery to checkout." : "The score summarizes the same three deterministic journey findings.", businessModel: journey.businessModels[0], primaryConversion: journey.primaryConversionType, estimatedClicks: journey.primary.clicksToInterface },
    gaps: categories.map((item, index) => finding(item, homepage, index + 1)),
    stats: { pagesCrawled: pages.length, internalLinks: internalLinks.size, actionsFound: pages.reduce((sum, page) => sum + page.clickables.length, 0), conversionPathSteps: journey.primary.clicksToInterface, processingMs },
    journey,
    pages: pages.map((page) => ({ title: page.title, url: page.url, type: pageType(page, homepage), statusCode: page.statusCode })),
    improvementReport: improvementReport(categories.map((item, index) => finding(item, homepage, index + 1))),
    llmEnhanced: false,
  };
}
