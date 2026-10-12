import Anthropic from "@anthropic-ai/sdk";
import { LeadSchema, type InboundMessage, type Lead } from "./types.js";

export interface Extractor { extract(msg: InboundMessage): Promise<Lead> }

const PROMPT = `Extract a service lead from this message for an HVAC/plumbing contractor.
Return JSON only with keys: name, company, email, phone, service
(hvac_install|hvac_repair|maintenance_plan|plumbing_repair|water_heater|other), units (int or null),
zip, urgency (emergency|soon|flexible), isSpam (sales pitches, SEO, loans), notes (one sentence).
Use null when a field isn't stated. Don't guess.`;

export class ClaudeExtractor implements Extractor {
  constructor(private client = new Anthropic(), private model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5") {}

  async extract(msg: InboundMessage): Promise<Lead> {
    const r = await this.client.messages.create({
      model: this.model,
      max_tokens: 400,
      system: PROMPT,
      messages: [{ role: "user", content: `From: ${msg.from}\nSubject: ${msg.subject ?? ""}\n\n${msg.body}` }],
    });
    const text = r.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    return LeadSchema.parse(JSON.parse(json)); // throws on bad output -> job retries
  }
}

// Keyword extractor for tests and local runs without an API key.
export class RuleExtractor implements Extractor {
  async extract(msg: InboundMessage): Promise<Lead> {
    const t = `${msg.subject ?? ""}\n${msg.body}`;
    const has = (re: RegExp) => re.test(t);
    const service: Lead["service"] =
      has(/maintenance|tune.?up|service plan|rtu/i) ? "maintenance_plan"
      : has(/water heater/i) ? "water_heater"
      : has(/install|replace (my|the|our) (furnace|ac|unit)|new (furnace|ac|system)/i) ? "hvac_install"
      : has(/leak|clog|drain|pipe|toilet/i) ? "plumbing_repair"
      : has(/furnace|ac\b|a\/c|heat|cool/i) ? "hvac_repair"
      : "other";
    const email = t.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? (msg.from.includes("@") ? msg.from : null);
    return {
      name: t.match(/(?:^|\n)\s*(?:thanks|regards|best|-+)\s*,?\s*\n\s*([A-Z][a-z]+(?: [A-Z][a-z]+)?)/i)?.[1] ?? null,
      company: t.match(/\b([A-Z][\w&]*(?: [A-Z][\w&]*)* (?:LLC|Inc|Properties|Management|Group))\b/)?.[1] ?? null,
      email,
      phone: t.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)?.[0] ?? null,
      service,
      units: Number(t.match(/(\d+)\s*(?:rooftop |rtu|units?|buildings?)/i)?.[1]) || null,
      zip: t.match(/\b(\d{5})\b/)?.[1] ?? null,
      urgency: has(/asap|urgent|emergency|today|flood/i) ? "emergency" : has(/this week|soon/i) ? "soon" : "flexible",
      isSpam: has(/\bseo\b|backlinks|business loan|guest post|rank (you|your)/i),
      notes: t.replace(/\s+/g, " ").slice(0, 140),
    };
  }
}
