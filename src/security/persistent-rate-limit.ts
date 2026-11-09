/**
 * Sliding window stored in SQLite so restarts and extra processes that share
 * the same database file see the same hits. This process does not trust
 * X-Forwarded-For. Enable Express trust proxy only after the proxy in front
 * of it is known, or req.ip will be the proxy rather than the visitor.
 */

import type Database from "better-sqlite3";

export class PersistentSlidingWindowLimiter {
  constructor(
    private readonly db: Database.Database,
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly prefix: string
  ) {}

  check(key: string, now = Date.now()): boolean {
    const bucket = `${this.prefix}:${key}`;
    const cutoff = now - this.windowMs;
    const count = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM rate_limit_hits WHERE bucket = ? AND hit_at <= ?`).run(bucket, cutoff);
      const row = this.db.prepare(`SELECT COUNT(*) AS n FROM rate_limit_hits WHERE bucket = ?`).get(bucket) as { n: number };
      if (row.n >= this.limit) return row.n;
      this.db.prepare(`INSERT INTO rate_limit_hits (bucket, hit_at) VALUES (?, ?)`).run(bucket, now);
      return row.n + 1;
    })();
    return count <= this.limit;
  }
}
