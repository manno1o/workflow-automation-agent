import { createServer } from "node:http";
import { Pipeline } from "./pipeline.js";
import { ClaudeExtractor, RuleExtractor } from "./extract.js";
import { FakeBilling, FakeCRM, FakeMailer, FakeNotifier, HubSpotCRM, StripeBilling } from "./integrations.js";
import { Store } from "./store.js";
import { Channel } from "./types.js";

const store = new Store();
const pipeline = new Pipeline({
  store,
  extractor: process.env.ANTHROPIC_API_KEY ? new ClaudeExtractor() : new RuleExtractor(),
  crm: process.env.HUBSPOT_TOKEN ? new HubSpotCRM(process.env.HUBSPOT_TOKEN) : new FakeCRM(),
  billing: process.env.STRIPE_KEY ? new StripeBilling(process.env.STRIPE_KEY) : new FakeBilling(),
  mailer: new FakeMailer(), // TODO gmail
  notifier: new FakeNotifier(), // TODO telegram
});

const body = async (req: import("node:http").IncomingMessage) => {
  let s = "";
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
};

createServer(async (req, res) => {
  const send = (code: number, data: unknown) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
  try {
    const url = new URL(req.url ?? "/", "http://x");
    const m = url.pathname.match(/^\/inbound\/(\w+)$/);
    if (req.method === "POST" && m) {
      const b = await body(req);
      const r = await pipeline.ingest({ channel: Channel.parse(m[1]), externalId: String(b.id), from: String(b.from ?? ""),
        subject: b.subject, body: String(b.body ?? ""), receivedAt: new Date().toISOString() });
      return send(r.duplicate ? 200 : 201, r.job);
    }
    const a = url.pathname.match(/^\/jobs\/(\w+)\/(approve|decline)$/);
    if (req.method === "POST" && a) return send(200, await pipeline.decide(a[1], a[2] === "approve", "api"));
    const j = url.pathname.match(/^\/jobs\/(\w+)$/);
    if (j) return send(200, { job: store.jobs.get(j[1]), events: store.history(j[1]) });
    if (url.pathname === "/jobs") return send(200, [...store.jobs.values()]);
    send(404, { error: "not found" });
  } catch (e) {
    send(400, { error: (e as Error).message });
  }
}).listen(Number(process.env.PORT ?? 8787), () => console.log("listening"));

setInterval(() => pipeline.retryPending().catch(console.error), 30_000).unref();
