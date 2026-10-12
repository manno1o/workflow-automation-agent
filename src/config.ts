import { ClaudeExtractor, RuleExtractor } from "./extract.js";
import { FakeBilling, FakeCRM, FakeMailer, FakeNotifier, HubSpotCRM, StripeBilling } from "./integrations.js";
import { GmailClient } from "./adapters/gmail.js";
import { TelegramClient } from "./adapters/telegram.js";
import type { Deps } from "./pipeline.js";
import type { AppConfig } from "./app.js";
import type { Store } from "./store.js";

// Real clients when keys are present, fakes otherwise.
export function wire(env: Record<string, string | undefined>, store: Store): { deps: Deps; cfg: AppConfig } {
  const gmail = env.GMAIL_REFRESH_TOKEN && env.GMAIL_CLIENT_ID && env.GMAIL_FROM
    ? new GmailClient({ clientId: env.GMAIL_CLIENT_ID!, clientSecret: env.GMAIL_CLIENT_SECRET!, refreshToken: env.GMAIL_REFRESH_TOKEN, from: env.GMAIL_FROM! })
    : undefined;
  const telegram = env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_APPROVAL_CHAT ? new TelegramClient(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_APPROVAL_CHAT!) : undefined;
  return {
    deps: {
      store,
      extractor: env.ANTHROPIC_API_KEY ? new ClaudeExtractor(undefined, env.ANTHROPIC_MODEL) : new RuleExtractor(),
      crm: env.HUBSPOT_TOKEN ? new HubSpotCRM(env.HUBSPOT_TOKEN) : new FakeCRM(),
      billing: env.STRIPE_KEY ? new StripeBilling(env.STRIPE_KEY) : new FakeBilling(),
      mailer: gmail ?? new FakeMailer(),
      notifier: telegram ?? new FakeNotifier(),
    },
    cfg: { apiKey: env.API_KEY, telegramSecret: env.TELEGRAM_WEBHOOK_SECRET, telegramApprovalChat: env.TELEGRAM_APPROVAL_CHAT, telegram, gmail },
  };
}
