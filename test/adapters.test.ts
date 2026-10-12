import { describe, expect, it } from "vitest";
import { b64url, fromB64url, GmailClient, parseGmailMessage, quoteEmail } from "../src/adapters/gmail.js";
import { fakeFetch } from "./helpers.js";
import { buildQuote } from "../src/pricebook.js";
import type { Lead } from "../src/types.js";

const lead: Lead = { name: "Dana Reyes", company: null, email: "dana@example.com", phone: null, service: "water_heater", units: null, zip: "60614", urgency: "soon", isSpam: false, notes: "" };

describe("gmail", () => {
  it("parses a multipart message", () => {
    const m = parseGmailMessage({
      id: "m1", internalDate: "1760000000000",
      payload: { mimeType: "multipart/alternative", headers: [{ name: "From", value: "Dana <dana@example.com>" }, { name: "Subject", value: "Quote" }],
        parts: [{ mimeType: "text/html", body: { data: b64url("<b>hi</b>") } }, { mimeType: "text/plain", body: { data: b64url("Need a water heater — 60614") } }] },
    });
    expect(m).toMatchObject({ from: "dana@example.com", subject: "Quote", body: "Need a water heater — 60614", externalId: "m1" });
  });

  it("refreshes token once and sends raw mail", async () => {
    const { f, calls } = fakeFetch({ "oauth2.googleapis.com": { access_token: "at", expires_in: 3600 } });
    const g = new GmailClient({ clientId: "c", clientSecret: "s", refreshToken: "r", from: "q@example.com" }, f);
    await g.sendQuote("dana@example.com", lead, buildQuote(lead));
    await g.sendQuote("dana@example.com", lead, buildQuote(lead));
    expect(calls.filter((c) => c.url.includes("oauth2")).length).toBe(1);
    const raw = fromB64url(JSON.parse(String(calls[1].init!.body)).raw);
    expect(raw).toContain("To: dana@example.com");
    expect(raw).toContain("Total: $1850.00");
  });

  it("polls, parses and marks read", async () => {
    const { f, calls } = fakeFetch({
      "oauth2": { access_token: "at", expires_in: 3600 },
      "messages?q=": { messages: [{ id: "a" }] },
      "messages/a?format=full": { id: "a", internalDate: "0", payload: { mimeType: "text/plain", headers: [], body: { data: b64url("clogged drain") } } },
    });
    const g = new GmailClient({ clientId: "c", clientSecret: "s", refreshToken: "r", from: "q@example.com" }, f);
    const msgs = await g.fetchNew();
    expect(msgs[0].body).toBe("clogged drain");
    expect(calls.some((c) => c.url.includes("messages/a/modify"))).toBe(true);
  });

  it("site-visit quotes ask for times", () => {
    expect(quoteEmail({ ...lead, service: "hvac_install" }, buildQuote({ ...lead, service: "hvac_install" })).text).toContain("site visit");
  });
});
