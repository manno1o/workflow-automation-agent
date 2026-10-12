/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { TelegramClient } from "../src/adapters/telegram.js";
import { fakeDeps, fakeFetch } from "./helpers.js";

const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://x${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });

describe("http app", () => {
  it("requires api key", async () => {
    const app = createApp(fakeDeps(), { apiKey: "k" });
    expect((await app.fetch(req("GET", "/jobs"))).status).toBe(401);
    expect((await app.fetch(req("GET", "/jobs", undefined, { "x-api-key": "k" }))).status).toBe(200);
    expect((await app.fetch(req("GET", "/health"))).status).toBe(200);
  });

  it("ingests, dedupes, approves", async () => {
    const d = fakeDeps();
    const app = createApp(d);
    const lead = { id: "f1", from: "ops@example.com", body: "Quarterly maintenance for 6 rooftop units at Westlake Management, 60607" };
    const r1 = await app.fetch(req("POST", "/inbound/webform", lead));
    expect(r1.status).toBe(201);
    const job: any = await r1.json();
    expect(job.state).toBe("awaiting_approval");
    expect((await app.fetch(req("POST", "/inbound/webform", lead))).status).toBe(200);
    const ok = await app.fetch(req("POST", `/jobs/${job.id}/approve`));
    expect(((await ok.json()) as any).state).toBe("sent");
    expect((await app.fetch(req("POST", `/jobs/${job.id}/approve`))).status).toBe(409);
    const detail: any = await (await app.fetch(req("GET", `/jobs/${job.id}`))).json();
    expect(detail.events.map((e: { type: string }) => e.type)).toEqual(["received", "extracted", "quoted", "awaiting_approval", "approved", "sent"]);
  });

  it("validates input", async () => {
    const app = createApp(fakeDeps());
    expect((await app.fetch(req("POST", "/inbound/fax", { id: "1", body: "x" }))).status).toBe(400);
    expect((await app.fetch(req("POST", "/inbound/email", { id: "1" }))).status).toBe(400);
    expect((await app.fetch(req("GET", "/jobs/nope"))).status).toBe(404);
  });

  it("telegram: lead in, approval button out, decision back", async () => {
    const d = fakeDeps();
    const { f, calls } = fakeFetch({});
    const tg = new TelegramClient("TOKEN", "-100", f);
    d.notifier = tg as never;
    const app = createApp(d, { telegramSecret: "s", telegramApprovalChat: "-100", telegram: tg });
    const hdr = { "x-telegram-bot-api-secret-token": "s" };
    expect((await app.fetch(req("POST", "/hooks/telegram", {}, {}))).status).toBe(401);

    await app.fetch(req("POST", "/hooks/telegram", {
      message: { message_id: 5, date: 1760000000, chat: { id: 42 }, from: { username: "dana" }, text: "Need a new water heater installed this week, 60614" },
    }, hdr));
    const [job] = await d.store.list();
    expect(job.state).toBe("awaiting_approval");
    const sent = JSON.parse(String(calls[0].init!.body));
    expect(sent.chat_id).toBe("-100");
    expect(sent.reply_markup.inline_keyboard[0][0].callback_data).toBe(`approve:${job.id}`);

    await app.fetch(req("POST", "/hooks/telegram", {
      callback_query: { id: "cb1", data: `approve:${job.id}`, from: { username: "owner" }, message: { chat: { id: -100 } } },
    }, hdr));
    expect((await d.store.get(job.id))!.state).toBe("sent");
    expect(calls.at(-1)!.url).toContain("answerCallbackQuery");
  });

  it("ignores approval clicks from other chats", async () => {
    const d = fakeDeps();
    const app = createApp(d, { telegramApprovalChat: "-100" });
    const r = await app.fetch(req("POST", "/inbound/email", { id: "w", from: "a@example.com", body: "water heater replacement" }));
    const job: any = await r.json();
    await app.fetch(req("POST", "/hooks/telegram", { callback_query: { id: "c", data: `approve:${job.id}`, message: { chat: { id: 999 } } } }));
    expect((await d.store.get(job.id))!.state).toBe("awaiting_approval");
  });
});
