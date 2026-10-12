// Node-only: SQLite through sql.js (wasm, no native build). Writes the db file after each change.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import initSqlJs from "sql.js";
import { SCHEMA, SqlStore, type SqlDb } from "./store.js";

export async function openSqlite(path = ":memory:"): Promise<SqlStore> {
  const SQL = await initSqlJs();
  const db = path !== ":memory:" && existsSync(path) ? new SQL.Database(readFileSync(path)) : new SQL.Database();
  db.exec(SCHEMA);
  const flush = () => {
    if (path === ":memory:") return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(db.export()));
  };
  const adapter: SqlDb = {
    async run(sql, params) { db.run(sql, params as never); flush(); },
    async all(sql, params) {
      const st = db.prepare(sql);
      st.bind(params as never);
      const out = [];
      while (st.step()) out.push(st.getAsObject());
      st.free();
      return out as never;
    },
  };
  flush();
  return new SqlStore(adapter);
}
