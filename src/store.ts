import type { Job } from "./types.js";

export interface Event { at: string; jobId: string; type: string; data?: unknown }

export interface Store {
  // Returns the existing job id if this dedupe key was seen before.
  claim(key: string, jobId: string): Promise<string | null>;
  save(job: Job, type: string, data?: unknown): Promise<void>;
  get(id: string): Promise<Job | undefined>;
  list(states?: Job["state"][]): Promise<Job[]>;
  history(jobId: string): Promise<Event[]>;
}

export class MemoryStore implements Store {
  private jobs = new Map<string, Job>();
  private events: Event[] = [];
  private seen = new Map<string, string>();

  async claim(key: string, jobId: string) {
    const prior = this.seen.get(key);
    if (prior) return prior;
    this.seen.set(key, jobId);
    return null;
  }
  async save(job: Job, type: string, data?: unknown) {
    this.jobs.set(job.id, structuredClone(job));
    this.events.push({ at: new Date().toISOString(), jobId: job.id, type, data });
  }
  async get(id: string) { const j = this.jobs.get(id); return j && structuredClone(j); }
  async list(states?: Job["state"][]) {
    return [...this.jobs.values()].filter((j) => !states || states.includes(j.state)).map((j) => structuredClone(j));
  }
  async history(jobId: string) { return this.events.filter((e) => e.jobId === jobId); }
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, state TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS jobs_state ON jobs(state);
CREATE TABLE IF NOT EXISTS dedupe (key TEXT PRIMARY KEY, job_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_job ON events(job_id);
`;

// Minimal async SQL surface that sql.js (Node) and D1 (Workers) both fit.
export interface SqlDb {
  run(sql: string, params: unknown[]): Promise<void>;
  all<T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]>;
}

export class SqlStore implements Store {
  constructor(private db: SqlDb) {}

  async claim(key: string, jobId: string) {
    await this.db.run("INSERT OR IGNORE INTO dedupe (key, job_id) VALUES (?, ?)", [key, jobId]);
    const [row] = await this.db.all<{ job_id: string }>("SELECT job_id FROM dedupe WHERE key = ?", [key]);
    return row.job_id === jobId ? null : row.job_id;
  }
  async save(job: Job, type: string, data?: unknown) {
    const now = new Date().toISOString();
    await this.db.run(
      "INSERT INTO jobs (id, state, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, data = excluded.data, updated_at = excluded.updated_at",
      [job.id, job.state, JSON.stringify(job), now],
    );
    await this.db.run("INSERT INTO events (job_id, type, data, at) VALUES (?, ?, ?, ?)", [job.id, type, data === undefined ? null : JSON.stringify(data), now]);
  }
  async get(id: string) {
    const [row] = await this.db.all<{ data: string }>("SELECT data FROM jobs WHERE id = ?", [id]);
    return row ? (JSON.parse(row.data) as Job) : undefined;
  }
  async list(states?: Job["state"][]) {
    const rows = states?.length
      ? await this.db.all<{ data: string }>(`SELECT data FROM jobs WHERE state IN (${states.map(() => "?").join(",")}) ORDER BY updated_at DESC`, states)
      : await this.db.all<{ data: string }>("SELECT data FROM jobs ORDER BY updated_at DESC", []);
    return rows.map((r) => JSON.parse(r.data) as Job);
  }
  async history(jobId: string) {
    const rows = await this.db.all<{ type: string; data: string | null; at: string }>("SELECT type, data, at FROM events WHERE job_id = ? ORDER BY id", [jobId]);
    return rows.map((r) => ({ jobId, type: r.type, at: r.at, data: r.data ? JSON.parse(r.data) : undefined }));
  }
}
