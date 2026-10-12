/// <reference types="@cloudflare/workers-types" />
import { createApp } from "./app.js";
import { wire } from "./config.js";
import { SqlStore, type SqlDb } from "./store.js";

interface Env { DB: D1Database; [k: string]: unknown }

function d1(db: D1Database): SqlDb {
  return {
    async run(sql, params) { await db.prepare(sql).bind(...params).run(); },
    async all(sql, params) { return (await db.prepare(sql).bind(...params).all()).results as never; },
  };
}

const appFor = (env: Env) => {
  const { deps, cfg } = wire(env as unknown as Record<string, string>, new SqlStore(d1(env.DB)));
  return createApp(deps, cfg);
};

export default {
  fetch: (req: Request, env: Env) => appFor(env).fetch(req),
  scheduled: async (_e: ScheduledEvent, env: Env, ctx: ExecutionContext) => { ctx.waitUntil(appFor(env).tick()); },
};
