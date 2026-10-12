import type { Job, Lead, Quote } from "./types.js";

export interface CRM { upsertDeal(lead: Lead, quote: Quote, key: string): Promise<string> }
export interface Billing { createInvoice(lead: Lead, quote: Quote, key: string): Promise<string> }
export interface Mailer { sendQuote(to: string, lead: Lead, quote: Quote): Promise<void> }
export interface Notifier { askApproval(job: Job): Promise<void> }

export class HubSpotCRM implements CRM {
  constructor(private token: string) {}
  async upsertDeal(lead: Lead, quote: Quote, key: string) {
    const r = await fetch("https://api.hubapi.com/crm/v3/objects/deals", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ properties: {
        dealname: `${lead.company ?? lead.name ?? "Lead"} - ${lead.service}`,
        amount: String(quote.total), pipeline: "default", dealstage: "appointmentscheduled",
        wfa_key: key,
      } }),
    });
    if (!r.ok) throw new Error(`hubspot ${r.status}`);
    return ((await r.json()) as { id: string }).id;
  }
}

export class StripeBilling implements Billing {
  constructor(private key: string) {}
  private async call(path: string, form: Record<string, string>, idem: string) {
    const r = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.key}`, "Idempotency-Key": idem },
      body: new URLSearchParams(form),
    });
    if (!r.ok) throw new Error(`stripe ${path} ${r.status}`);
    return (await r.json()) as { id: string };
  }
  async createInvoice(lead: Lead, quote: Quote, key: string) {
    const cust = await this.call("customers", { email: lead.email ?? "", name: lead.name ?? lead.company ?? "" }, `${key}-cust`);
    const inv = await this.call("invoices", { customer: cust.id, collection_method: "send_invoice", days_until_due: "14" }, `${key}-inv`);
    for (const [i, l] of quote.lines.entries()) {
      await this.call("invoiceitems", {
        customer: cust.id, invoice: inv.id, description: l.description,
        quantity: String(l.qty), unit_amount_decimal: String(l.unitPrice * 100), currency: "usd",
      }, `${key}-item-${i}`);
    }
    return inv.id;
  }
}

// Fakes, used by tests and `npm start` without keys.
export class FakeCRM implements CRM {
  deals: { key: string; amount: number }[] = [];
  failTimes = 0;
  async upsertDeal(_l: Lead, q: Quote, key: string) {
    if (this.failTimes > 0) { this.failTimes--; throw new Error("crm 503"); }
    const found = this.deals.findIndex((d) => d.key === key);
    if (found >= 0) return `deal_${found}`;
    this.deals.push({ key, amount: q.total });
    return `deal_${this.deals.length - 1}`;
  }
}
export class FakeBilling implements Billing {
  invoices: string[] = [];
  async createInvoice(_l: Lead, _q: Quote, key: string) {
    if (!this.invoices.includes(key)) this.invoices.push(key);
    return `in_${this.invoices.indexOf(key)}`;
  }
}
export class FakeMailer implements Mailer {
  sent: { to: string; total: number }[] = [];
  async sendQuote(to: string, _l: Lead, q: Quote) { this.sent.push({ to, total: q.total }); }
}
export class FakeNotifier implements Notifier {
  asked: string[] = [];
  async askApproval(job: Job) { this.asked.push(job.id); }
}
