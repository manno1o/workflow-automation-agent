import { randomUUID, createHash } from "node:crypto";
import { buildQuote } from "./pricebook.js";
import type { Extractor } from "./extract.js";
import type { Billing, CRM, Mailer, Notifier } from "./integrations.js";
import type { Store } from "./store.js";
import type { InboundMessage, Job } from "./types.js";

export interface Deps { store: Store; extractor: Extractor; crm: CRM; billing: Billing; mailer: Mailer; notifier: Notifier }

// Quotes at or above this go to a human before anything is sent.
export const AUTO_APPROVE_LIMIT = 500;
export const MAX_ATTEMPTS = 4;

export const dedupeKey = (m: InboundMessage) =>
  createHash("sha256").update(`${m.channel}:${m.externalId}`).digest("hex").slice(0, 16);

export class Pipeline {
  constructor(private d: Deps) {}

  async ingest(msg: InboundMessage): Promise<{ job: Job; duplicate: boolean }> {
    const id = randomUUID().slice(0, 8);
    const prior = await this.d.store.claim(dedupeKey(msg), id);
    if (prior) return { job: (await this.d.store.get(prior))!, duplicate: true };
    const job: Job = { id, state: "received", inbound: msg, attempts: 0 };
    await this.d.store.save(job, "received");
    await this.run(job);
    return { job: (await this.d.store.get(id))!, duplicate: false };
  }

  // Advance a job as far as it can go. Safe to call again after a failure.
  async run(job: Job): Promise<Job> {
    try {
      if (job.state === "received") {
        job.lead = await this.d.extractor.extract(job.inbound);
        if (job.lead.isSpam) return await this.move(job, "rejected", { reason: "spam" });
        if (!job.lead.email && !job.lead.phone && job.inbound.channel !== "telegram") return await this.move(job, "rejected", { reason: "no contact info" });
        await this.move(job, "extracted");
      }
      if (job.state === "extracted") {
        job.quote = buildQuote(job.lead!);
        await this.move(job, "quoted", { total: job.quote.total });
      }
      if (job.state === "quoted") {
        if (job.quote!.total >= AUTO_APPROVE_LIMIT || job.lead!.urgency === "emergency") {
          await this.d.notifier.askApproval(job);
          return await this.move(job, "awaiting_approval");
        }
        await this.move(job, "approved", { by: "auto" });
      }
      if (job.state === "approved") {
        const key = dedupeKey(job.inbound);
        job.crmDealId = await this.d.crm.upsertDeal(job.lead!, job.quote!, key);
        if (!job.quote!.needsSiteVisit) job.invoiceId = await this.d.billing.createInvoice(job.lead!, job.quote!, key);
        if (job.lead!.email) await this.d.mailer.sendQuote(job.lead!.email, job.lead!, job.quote!);
        await this.move(job, "sent", { deal: job.crmDealId, invoice: job.invoiceId });
      }
      return job;
    } catch (e) {
      job.attempts++;
      const err = (e as Error).message;
      if (job.attempts >= MAX_ATTEMPTS) return await this.move(job, "failed", { error: err });
      await this.d.store.save(job, "error", { error: err, attempt: job.attempts });
      return job;
    }
  }

  async decide(jobId: string, approve: boolean, by: string): Promise<Job> {
    const job = await this.d.store.get(jobId);
    if (!job) throw new Error("not found");
    if (job.state !== "awaiting_approval") throw new Error(`job is ${job.state}`);
    if (!approve) return await this.move(job, "declined", { by });
    await this.move(job, "approved", { by });
    return this.run(job);
  }

  // Retry jobs that errored. Run from a cron / queue consumer.
  async retryPending(): Promise<number> {
    let n = 0;
    for (const job of await this.d.store.list(["received", "extracted", "quoted", "approved"])) {
      if (job.attempts > 0) {
        await this.run(job);
        n++;
      }
    }
    return n;
  }

  private async move(job: Job, state: Job["state"], data?: Record<string, unknown>) {
    job.state = state;
    if (data?.reason) job.reason = String(data.reason);
    await this.d.store.save(job, state, data);
    return job;
  }
}
