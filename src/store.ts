import type { Job } from "./types.js";

// Append-only event log + current job snapshots. Swap for Postgres/D1 in prod.
export interface Event { at: string; jobId: string; type: string; data?: unknown }

export class Store {
  jobs = new Map<string, Job>();
  events: Event[] = [];
  private seen = new Map<string, string>(); // dedupe key -> job id

  claim(key: string, jobId: string): string | null {
    const existing = this.seen.get(key);
    if (existing) return existing;
    this.seen.set(key, jobId);
    return null;
  }

  save(job: Job, type: string, data?: unknown) {
    this.jobs.set(job.id, structuredClone(job));
    this.events.push({ at: new Date().toISOString(), jobId: job.id, type, data });
  }

  history(jobId: string) {
    return this.events.filter((e) => e.jobId === jobId);
  }
}
