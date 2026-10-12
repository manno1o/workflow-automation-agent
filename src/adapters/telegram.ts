import type { Notifier } from "../integrations.js";
import type { InboundMessage, Job } from "../types.js";

type Fetch = typeof fetch;

export type TelegramAction =
  | { kind: "inbound"; msg: InboundMessage }
  | { kind: "decision"; jobId: string; approve: boolean; by: string; callbackId: string }
  | { kind: "ignore" };

export function approvalText(job: Job): string {
  const l = job.lead!, q = job.quote!;
  const items = q.lines.map((x) => `• ${x.description} x${x.qty} = $${x.qty * x.unitPrice}`).join("\n");
  return [
    `New quote ${job.id} (${l.urgency})`,
    `${l.company ?? l.name ?? "Unknown"} · ${l.email ?? l.phone ?? ""} · ${l.zip ?? "no zip"}`,
    items,
    `Total $${q.total}${q.needsSiteVisit ? " (site visit)" : ""}`,
    `"${l.notes.slice(0, 120)}"`,
  ].join("\n");
}

export class TelegramClient implements Notifier {
  constructor(private token: string, private chatId: string, private f: Fetch = fetch) {}

  private async call(method: string, body: unknown) {
    const r = await this.f(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const j = (await r.json()) as { ok: boolean; description?: string };
    if (!j.ok) throw new Error(`telegram ${method}: ${j.description}`);
    return j;
  }

  async askApproval(job: Job) {
    await this.call("sendMessage", {
      chat_id: this.chatId,
      text: approvalText(job),
      reply_markup: { inline_keyboard: [[
        { text: "Approve", callback_data: `approve:${job.id}` },
        { text: "Decline", callback_data: `decline:${job.id}` },
      ]] },
    });
  }

  async ack(callbackId: string, text: string) {
    await this.call("answerCallbackQuery", { callback_query_id: callbackId, text });
  }
}

// Parse a webhook update. Messages from the approval chat are decisions; anything else is a lead.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseUpdate(u: any, approvalChatId: string): TelegramAction {
  if (u.callback_query) {
    const [verb, jobId] = String(u.callback_query.data ?? "").split(":");
    if (!jobId || !["approve", "decline"].includes(verb)) return { kind: "ignore" };
    if (String(u.callback_query.message?.chat?.id) !== approvalChatId) return { kind: "ignore" };
    const who = u.callback_query.from;
    return { kind: "decision", jobId, approve: verb === "approve", by: `telegram:${who?.username ?? who?.id}`, callbackId: u.callback_query.id };
  }
  const m = u.message;
  if (!m?.text || String(m.chat?.id) === approvalChatId) return { kind: "ignore" };
  return {
    kind: "inbound",
    msg: {
      channel: "telegram",
      externalId: `${m.chat.id}:${m.message_id}`,
      from: m.from?.username ? `@${m.from.username}` : String(m.from?.id ?? ""),
      body: m.text,
      receivedAt: new Date(m.date * 1000).toISOString(),
    },
  };
}
