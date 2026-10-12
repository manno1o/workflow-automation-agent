// Extraction evals. `npm run eval` uses the keyword extractor (CI);
// `npm run eval -- --real` uses Claude (needs ANTHROPIC_API_KEY).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { ClaudeExtractor, RuleExtractor, type Extractor } from "../src/extract.js";
import type { InboundMessage, Lead } from "../src/types.js";

interface Case { id: string; channel: InboundMessage["channel"]; from: string; subject: string; body: string; expect: Partial<Lead> }

const args = process.argv.slice(2);
const real = args.includes("--real");
const min = Number(args.find((a) => a.startsWith("--min="))?.slice(6) ?? 0.85);
const extractor: Extractor = real ? new ClaudeExtractor() : new RuleExtractor();
const cases: Case[] = readFileSync(new URL("./leads.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l));

const norm = (k: string, v: unknown) =>
  v == null ? null : k === "phone" ? String(v).replace(/\D/g, "").slice(-10) : typeof v === "string" ? v.toLowerCase().trim() : v;

const fieldHits: Record<string, [number, number]> = {};
const spam = { tp: 0, fp: 0, fn: 0 };
const rows: string[] = [];
for (const c of cases) {
  const msg: InboundMessage = { channel: c.channel, externalId: c.id, from: c.from, subject: c.subject, body: c.body, receivedAt: "" };
  let got: Lead | null = null;
  let err = "";
  try { got = await extractor.extract(msg); } catch (e) { err = (e as Error).message; }
  const misses: string[] = [];
  for (const [k, want] of Object.entries(c.expect)) {
    const have = got ? (got as Record<string, unknown>)[k] : undefined;
    const ok = norm(k, have) === norm(k, want);
    fieldHits[k] ??= [0, 0];
    fieldHits[k][0] += ok ? 1 : 0;
    fieldHits[k][1]++;
    if (!ok) misses.push(`${k}: got ${JSON.stringify(have)} want ${JSON.stringify(want)}`);
  }
  if (got?.isSpam && c.expect.isSpam) spam.tp++;
  if (got?.isSpam && !c.expect.isSpam) spam.fp++;
  if (!got?.isSpam && c.expect.isSpam) spam.fn++;
  rows.push(`| ${c.id} | ${misses.length || err ? "miss" : "ok"} | ${err || misses.join("; ")} |`);
}

const total = Object.values(fieldHits).reduce((a, [h, n]) => [a[0] + h, a[1] + n], [0, 0]);
const acc = total[0] / total[1];
const report = [
  `# Extraction eval (${real ? "claude" : "keyword"} extractor)`,
  "",
  `Field accuracy: **${(acc * 100).toFixed(1)}%** (${total[0]}/${total[1]}) on ${cases.length} messages`,
  `Spam: precision ${spam.tp / Math.max(1, spam.tp + spam.fp)}, recall ${spam.tp / Math.max(1, spam.tp + spam.fn)}`,
  "",
  "| field | accuracy |", "|---|---|",
  ...Object.entries(fieldHits).map(([k, [h, n]]) => `| ${k} | ${h}/${n} |`),
  "",
  "| case | result | misses |", "|---|---|---|",
  ...rows,
].join("\n");
mkdirSync("evals/results", { recursive: true });
writeFileSync("evals/results/report.md", report + "\n");
console.log(report);
// Never let spam through to a quote, regardless of overall accuracy.
process.exit(acc >= min && spam.fn === 0 && spam.fp === 0 ? 0 : 1);
