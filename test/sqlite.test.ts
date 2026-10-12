import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openSqlite } from "../src/sqlite.js";

it("persists jobs, events and dedupe keys across restarts", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "wfa-")), "db.sqlite");
  const a = await openSqlite(path);
  expect(await a.claim("k1", "j1")).toBeNull();
  await a.save({ id: "j1", state: "received", attempts: 0, inbound: { channel: "email", externalId: "x", from: "", body: "hi", receivedAt: "" } }, "received");
  const b = await openSqlite(path);
  expect(await b.claim("k1", "j2")).toBe("j1");
  expect((await b.get("j1"))!.state).toBe("received");
  expect(await b.history("j1")).toHaveLength(1);
});
