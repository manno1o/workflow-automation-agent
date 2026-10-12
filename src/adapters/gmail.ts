import type { Mailer } from "../integrations.js";
import type { InboundMessage, Lead, Quote } from "../types.js";

type Fetch = typeof fetch;
export interface GmailCreds { clientId: string; clientSecret: string; refreshToken: string; from: string }

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

export function quoteEmail(lead: Lead, quote: Quote): { subject: string; text: string } {
  const lines = quote.lines.map((l) => `  ${l.description} x${l.qty}: $${(l.qty * l.unitPrice).toFixed(2)}`).join("\n");
  const hi = lead.name ? `Hi ${lead.name.split(" ")[0]},` : "Hi,";
  const visit = quote.needsSiteVisit ? "\nWe'll need a quick site visit to price the install. Reply with a couple of times that work.\n" : "";
  return {
    subject: "Your quote",
    text: `${hi}\n\nThanks for reaching out. Here's what we'd propose:\n\n${lines}\n\nTotal: $${quote.total.toFixed(2)}\n${visit}\nReply to this email with any questions.\n`,
  };
}

export class GmailClient implements Mailer {
  private token?: { value: string; exp: number };
  constructor(private creds: GmailCreds, private f: Fetch = fetch) {}

  private async accessToken() {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    const r = await this.f("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({ client_id: this.creds.clientId, client_secret: this.creds.clientSecret, refresh_token: this.creds.refreshToken, grant_type: "refresh_token" }),
    });
    if (!r.ok) throw new Error(`gmail token ${r.status}`);
    const j = (await r.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const r = await this.f(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      ...init, headers: { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/json" },
    });
    if (!r.ok) throw new Error(`gmail ${path.split("?")[0]} ${r.status}`);
    return (await r.json()) as T;
  }

  async sendQuote(to: string, lead: Lead, quote: Quote) {
    const { subject, text } = quoteEmail(lead, quote);
    const raw = [`From: ${this.creds.from}`, `To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=UTF-8", "", text].join("\r\n");
    await this.api("messages/send", { method: "POST", body: JSON.stringify({ raw: b64url(raw) }) });
  }

  // Poll for new leads. Messages are marked read once returned.
  async fetchNew(query = "in:inbox is:unread newer_than:2d"): Promise<InboundMessage[]> {
    const list = await this.api<{ messages?: { id: string }[] }>(`messages?q=${encodeURIComponent(query)}&maxResults=20`);
    const out: InboundMessage[] = [];
    for (const { id } of list.messages ?? []) {
      const m = await this.api<GmailMessage>(`messages/${id}?format=full`);
      out.push(parseGmailMessage(m));
      await this.api(`messages/${id}/modify`, { method: "POST", body: JSON.stringify({ removeLabelIds: ["UNREAD"] }) });
    }
    return out;
  }
}

interface Part { mimeType: string; body?: { data?: string }; parts?: Part[] }
export interface GmailMessage { id: string; internalDate: string; payload: Part & { headers: { name: string; value: string }[] } }

function findText(p: Part): string {
  if (p.mimeType === "text/plain" && p.body?.data) return fromB64url(p.body.data);
  for (const c of p.parts ?? []) { const t = findText(c); if (t) return t; }
  return "";
}

export function parseGmailMessage(m: GmailMessage): InboundMessage {
  const h = (n: string) => m.payload.headers.find((x) => x.name.toLowerCase() === n)?.value ?? "";
  const from = h("from");
  return {
    channel: "email",
    externalId: m.id,
    from: from.match(/<([^>]+)>/)?.[1] ?? from,
    subject: h("subject"),
    body: findText(m.payload),
    receivedAt: new Date(Number(m.internalDate)).toISOString(),
  };
}

export { b64url, fromB64url };
