import { Pipeline, type Deps } from "./pipeline.js";
import { Channel } from "./types.js";
import { parseUpdate, TelegramClient } from "./adapters/telegram.js";
import type { GmailClient } from "./adapters/gmail.js";

export interface AppConfig {
  apiKey?: string;               // required for /inbound, /jobs when set
  telegramSecret?: string;       // X-Telegram-Bot-Api-Secret-Token
  telegramApprovalChat?: string;
  telegram?: TelegramClient;
  gmail?: GmailClient;
}

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export function createApp(deps: Deps, cfg: AppConfig = {}) {
  const pipeline = new Pipeline(deps);
  const authed = (req: Request) => !cfg.apiKey || req.headers.get("x-api-key") === cfg.apiKey;

  async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path === "/health") return json(200, { ok: true });

      if (req.method === "POST" && path === "/hooks/telegram") {
        if (cfg.telegramSecret && req.headers.get("x-telegram-bot-api-secret-token") !== cfg.telegramSecret) return json(401, { error: "bad secret" });
        const action = parseUpdate(await req.json(), cfg.telegramApprovalChat ?? "");
        if (action.kind === "inbound") await pipeline.ingest(action.msg);
        if (action.kind === "decision") {
          const job = await pipeline.decide(action.jobId, action.approve, action.by).catch((e: Error) => ({ state: e.message }));
          await cfg.telegram?.ack(action.callbackId, `Job ${action.jobId}: ${job.state}`);
        }
        return json(200, { ok: true }); // always 200 so Telegram doesn't redeliver
      }

      if (!authed(req)) return json(401, { error: "unauthorized" });

      const inbound = path.match(/^\/inbound\/(\w+)$/);
      if (req.method === "POST" && inbound) {
        const b = (await req.json()) as Record<string, unknown>;
        if (!b.id || !b.body) return json(400, { error: "id and body are required" });
        const r = await pipeline.ingest({
          channel: Channel.parse(inbound[1]), externalId: String(b.id), from: String(b.from ?? ""),
          subject: b.subject ? String(b.subject) : undefined, body: String(b.body), receivedAt: new Date().toISOString(),
        });
        return json(r.duplicate ? 200 : 201, r.job);
      }
      const decide = path.match(/^\/jobs\/([\w-]+)\/(approve|decline)$/);
      if (req.method === "POST" && decide) return json(200, await pipeline.decide(decide[1], decide[2] === "approve", "api"));
      const one = path.match(/^\/jobs\/([\w-]+)$/);
      if (req.method === "GET" && one) {
        const job = await deps.store.get(one[1]);
        return job ? json(200, { job, events: await deps.store.history(one[1]) }) : json(404, { error: "not found" });
      }
      if (req.method === "GET" && path === "/jobs") {
        const state = url.searchParams.get("state");
        return json(200, await deps.store.list(state ? [state as never] : undefined));
      }
      return json(404, { error: "not found" });
    } catch (e) {
      const msg = (e as Error).message;
      return json(/not found/.test(msg) ? 404 : /job is/.test(msg) ? 409 : 400, { error: msg });
    }
  }

  // Run every minute or so: pull new Gmail leads, retry failed steps.
  async function tick() {
    let pulled = 0;
    if (cfg.gmail) for (const m of await cfg.gmail.fetchNew()) { await pipeline.ingest(m); pulled++; }
    const retried = await pipeline.retryPending();
    return { pulled, retried };
  }

  return { fetch, tick, pipeline };
}
