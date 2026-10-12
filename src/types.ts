import { z } from "zod";

export const Channel = z.enum(["email", "webform", "telegram"]);
export type Channel = z.infer<typeof Channel>;

export interface InboundMessage {
  channel: Channel;
  externalId: string; // provider message id, used for dedupe
  from: string;
  subject?: string;
  body: string;
  receivedAt: string;
}

export const LeadSchema = z.object({
  name: z.string().nullable(),
  company: z.string().nullable(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  service: z.enum(["hvac_install", "hvac_repair", "maintenance_plan", "plumbing_repair", "water_heater", "other"]),
  units: z.number().int().positive().nullable(),
  zip: z.string().nullable(),
  urgency: z.enum(["emergency", "soon", "flexible"]),
  isSpam: z.boolean(),
  notes: z.string(),
});
export type Lead = z.infer<typeof LeadSchema>;

export interface QuoteLine { sku: string; description: string; qty: number; unitPrice: number }
export interface Quote { lines: QuoteLine[]; subtotal: number; total: number; needsSiteVisit: boolean }

export type JobState =
  | "received" | "extracted" | "rejected" | "quoted" | "awaiting_approval"
  | "approved" | "declined" | "sent" | "failed";

export interface Job {
  id: string;
  state: JobState;
  inbound: InboundMessage;
  lead?: Lead;
  quote?: Quote;
  reason?: string;
  crmDealId?: string;
  invoiceId?: string;
  attempts: number;
}
