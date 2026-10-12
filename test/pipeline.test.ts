import { describe, expect, it } from "vitest";
import { Pipeline, MAX_ATTEMPTS } from "../src/pipeline.js";
import { RuleExtractor } from "../src/extract.js";
import { FakeBilling, FakeCRM, FakeMailer, FakeNotifier } from "../src/integrations.js";
import { Store } from "../src/store.js";
import type { InboundMessage } from "../src/types.js";

function setup() {
  const d = { store: new Store(), extractor: new RuleExtractor(), crm: new FakeCRM(), billing: new FakeBilling(), mailer: new FakeMailer(), notifier: new FakeNotifier() };
  return { d, p: new Pipeline(d) };
}
const msg = (body: string, extra: Partial<InboundMessage> = {}): InboundMessage => ({
  channel: "email", externalId: Math.random().toString(36), from: "pat@example.com", body, receivedAt: "2026-10-12T15:00:00Z", ...extra,
});

describe("pipeline", () => {
  it("auto-sends small quotes", async () => {
    const { p, d } = setup();
    const { job } = await p.ingest(msg("Hi, kitchen drain is clogged, zip 60614. Call 312-555-0100"));
    expect(job.state).toBe("sent");
    expect(job.quote!.total).toBe(89);
    expect(d.mailer.sent).toHaveLength(1);
    expect(d.billing.invoices).toHaveLength(1);
  });

  it("holds big quotes for approval, then sends", async () => {
    const { p, d } = setup();
    const { job } = await p.ingest(msg("Need maintenance for 8 rooftop units at Northside Properties, 60640."));
    expect(job.state).toBe("awaiting_approval");
    expect(job.quote!.total).toBe(Math.round(8 * 245 * 0.9));
    expect(d.mailer.sent).toHaveLength(0);
    const done = await p.decide(job.id, true, "dispatcher");
    expect(done.state).toBe("sent");
  });

  it("declined quotes never go out", async () => {
    const { p, d } = setup();
    const { job } = await p.ingest(msg("Water heater replacement please"));
    await p.decide(job.id, false, "owner");
    expect(d.store.jobs.get(job.id)!.state).toBe("declined");
    expect(d.mailer.sent).toHaveLength(0);
  });

  it("rejects spam and leads with no contact", async () => {
    const { p } = setup();
    expect((await p.ingest(msg("We can rank your site #1 with SEO backlinks"))).job.reason).toBe("spam");
    expect((await p.ingest(msg("furnace broken", { from: "webform" }))).job.reason).toBe("no contact info");
  });

  it("dedupes the same inbound message", async () => {
    const { p, d } = setup();
    const m = msg("toilet clogged", { externalId: "abc" });
    await p.ingest(m);
    const again = await p.ingest(m);
    expect(again.duplicate).toBe(true);
    expect(d.mailer.sent).toHaveLength(1);
  });

  it("retries after a CRM outage without double-creating", async () => {
    const { p, d } = setup();
    d.crm.failTimes = 2;
    const { job } = await p.ingest(msg("leaky pipe under sink"));
    expect(job.state).toBe("approved");
    await p.retryPending();
    await p.retryPending();
    expect(d.store.jobs.get(job.id)!.state).toBe("sent");
    expect(d.crm.deals).toHaveLength(1);
  });

  it("gives up after max attempts", async () => {
    const { p, d } = setup();
    d.crm.failTimes = 99;
    const { job } = await p.ingest(msg("leaky pipe"));
    for (let i = 0; i < MAX_ATTEMPTS; i++) await p.retryPending();
    expect(d.store.jobs.get(job.id)!.state).toBe("failed");
    expect(d.store.history(job.id).map((e) => e.type)).toContain("error");
  });

  it("emergencies always go to a human", async () => {
    const { p } = setup();
    const { job } = await p.ingest(msg("Pipe burst, basement flooding, need someone ASAP"));
    expect(job.state).toBe("awaiting_approval");
  });
});
