import type { BusinessModel, CrawlPage } from "./types";

export type CommercialModel = "ecommerce" | "booking" | "software" | "marketplace" | "service" | "informational";
export type JourneyRole = "homepage" | "category" | "product" | "service" | "cart" | "checkout" | "conversion" | "pricing" | "trust" | "other";

function visibleText(page: CrawlPage) {
  return `${page.url} ${page.title} ${page.description} ${page.markdown.slice(0, 6000)} ${page.html.slice(0, 12000)}`.toLowerCase();
}

/** Classifies the commercial model before journey discovery starts. */
export function classifyCommercialModel(pages: CrawlPage[]): CommercialModel {
  const text = pages.map(visibleText).join(" ");
  const scores: Record<CommercialModel, number> = {
    ecommerce: 0,
    booking: 0,
    software: 0,
    marketplace: 0,
    service: 0,
    informational: 0,
  };
  if (/\b(add to (cart|bag|basket)|in winkelmand|winkelmandje|afrekenen|checkout)\b/i.test(text)) scores.ecommerce += 8;
  if (/\/(products?|product|collections?|collecties?|shop|winkel|cart|checkout)\b/i.test(text)) scores.ecommerce += 5;
  if (/\b(webshop|productcatalogus|product category|onze collectie|ons assortiment|alle categorie[eë]n|bekijk alles|shop nu|online bestellen)\b/i.test(text)) scores.ecommerce += 5;
  if (/(?:schema\.org\/Product|"@type"\s*:\s*"Product"|product-grid|product-card|product-list|mini-?cart|shopping-?bag|winkelmand)/i.test(text)) scores.ecommerce += 7;
  const priceSignals = text.match(/(?:€|eur\s*)\s*\d{1,5}(?:[.,]\d{2})?|\b\d{1,4}[,.]\d{2}\b/gi) || [];
  if (priceSignals.length >= 2) scores.ecommerce += 6;
  if ((text.match(/href\s*=\s*["'][^"']+(?:artikel|item|sku|product|shop)[^"']*["']/gi) || []).length >= 2) scores.ecommerce += 4;
  if (/\b(boek (nu|online)|booking|afspraak maken|plan een afspraak|reserveer|reservation)\b/i.test(text)) scores.booking += 7;
  if (/\/(booking|boeken|afspraak|reserveer)\b/i.test(text)) scores.booking += 4;
  if (/\b(saas|software|platform|cloud|subscription|abonnement)\b/i.test(text)) scores.software += 5;
  if (/\b(start trial|free trial|proefperiode|sign up|registreer|request demo|boek een demo)\b/i.test(text)) scores.software += 5;
  if (/\b(marketplace|marktplaats|aanbieders|verkopers|providers vergelijken|boek een professional)\b/i.test(text)) scores.marketplace += 8;
  if (/\b(offerte|prijsopgave|contact opnemen|adviesgesprek|onze diensten|service aan huis|installatie|onderhoud|reparatie)\b/i.test(text)) scores.service += 5;
  if (/\/(diensten?|services?|oplossingen?|offerte|contact)\b/i.test(text)) scores.service += 3;

  const ranked = (Object.entries(scores) as Array<[CommercialModel, number]>).filter(([model]) => model !== "informational").sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[1] > 0 ? ranked[0][0] : "informational";
}

export function journeyRolesForModel(model: CommercialModel): JourneyRole[] {
  if (model === "ecommerce") return ["homepage", "category", "product", "cart", "checkout"];
  if (model === "booking") return ["homepage", "service", "conversion"];
  if (model === "software") return ["homepage", "pricing", "conversion"];
  if (model === "marketplace") return ["homepage", "category", "product", "conversion"];
  if (model === "service") return ["homepage", "service", "conversion"];
  return ["homepage", "conversion"];
}

export function publicBusinessModels(model: CommercialModel, text = ""): BusinessModel[] {
  if (model === "ecommerce") return ["Ecommerce"];
  if (model === "booking") return ["Appointment or booking"];
  if (model === "software") return ["Software or subscription"];
  if (model === "marketplace") return ["Marketplace"];
  if (model === "service") {
    if (/\b(advocaat|accountant|consultancy|adviesbureau|makelaar|architect|agency|bureau)\b/i.test(text)) return ["Lead generation", "Professional services"];
    if (/\b(installatie|onderhoud|reparatie|service aan huis|werkgebied|lokale specialist)\b/i.test(text)) return ["Lead generation", "Local service business"];
    return ["Lead generation"];
  }
  return ["Informational or non-commercial"];
}
