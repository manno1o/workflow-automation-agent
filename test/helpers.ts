import { RuleExtractor } from "../src/extract.js";
import { FakeBilling, FakeCRM, FakeMailer, FakeNotifier } from "../src/integrations.js";
import { MemoryStore } from "../src/store.js";

export const fakeDeps = () => ({
  store: new MemoryStore(), extractor: new RuleExtractor(), crm: new FakeCRM(),
  billing: new FakeBilling(), mailer: new FakeMailer(), notifier: new FakeNotifier(),
});

// Records calls and answers with canned JSON per URL substring.
export function fakeFetch(routes: Record<string, unknown>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const hit = Object.keys(routes).find((k) => String(url).includes(k));
    return new Response(JSON.stringify(hit ? routes[hit] : { ok: true }), { status: hit ? 200 : 200 });
  }) as typeof fetch;
  return { f, calls };
}
