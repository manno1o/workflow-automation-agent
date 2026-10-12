import { createServer, type IncomingMessage } from "node:http";
import { createApp } from "./app.js";
import { wire } from "./config.js";
import { openSqlite } from "./sqlite.js";

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const body = ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : Buffer.concat(chunks);
  return new Request(`http://${req.headers.host ?? "localhost"}${req.url}`, { method: req.method, headers, body });
}

const store = await openSqlite(process.env.DB_PATH ?? "data/wfa.sqlite");
const { deps, cfg } = wire(process.env, store);
const app = createApp(deps, cfg);
const port = Number(process.env.PORT ?? 8787);

createServer(async (req, res) => {
  const r = await app.fetch(await toRequest(req));
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log(`listening on :${port}`));

setInterval(() => app.tick().catch((e) => console.error("tick", e)), 60_000).unref();
