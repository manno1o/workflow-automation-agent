import type { Lead, Quote, QuoteLine } from "./types.js";

// Example price book. Real shops load theirs from a sheet/CRM.
export const PRICE_BOOK: Record<string, { description: string; price: number }> = {
  DIAG: { description: "Diagnostic visit", price: 89 },
  MAINT_RES: { description: "Annual maintenance plan, per unit", price: 189 },
  MAINT_COM: { description: "Commercial RTU maintenance, per unit, per visit", price: 245 },
  WH_50: { description: "50 gal gas water heater, installed", price: 1850 },
  INSTALL_EST: { description: "Install estimate site visit", price: 0 },
};

const line = (sku: string, qty = 1): QuoteLine => ({ sku, qty, description: PRICE_BOOK[sku].description, unitPrice: PRICE_BOOK[sku].price });

export function buildQuote(lead: Lead): Quote {
  const units = lead.units ?? 1;
  let lines: QuoteLine[];
  let needsSiteVisit = false;
  switch (lead.service) {
    case "maintenance_plan":
      lines = [line(lead.company ? "MAINT_COM" : "MAINT_RES", units)];
      break;
    case "water_heater":
      lines = [line("WH_50")];
      break;
    case "hvac_install":
      lines = [line("INSTALL_EST")];
      needsSiteVisit = true;
      break;
    default:
      lines = [line("DIAG")];
  }
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  // Volume discount for 5+ commercial units
  const total = lead.company && units >= 5 ? Math.round(subtotal * 0.9) : subtotal;
  return { lines, subtotal, total, needsSiteVisit };
}
