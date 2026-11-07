/**
 * In-memory sliding-window rate limiter.
 *
 * Known limitation: state is per-process and resets on restart; it does not
 * coordinate across multiple instances. Documented in README as a limitation
 * to revisit (e.g. move to a shared store) before scaling past one instance.
 */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  /** Records a hit for `key` and returns true if it is still within the limit. */
  check(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const existing = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (existing.length >= this.limit) {
      this.hits.set(key, existing);
      return false;
    }
    existing.push(now);
    this.hits.set(key, existing);
    return true;
  }

  /** Count within the current window without recording a new hit. */
  count(key: string, now = Date.now()): number {
    const cutoff = now - this.windowMs;
    return (this.hits.get(key) ?? []).filter((t) => t > cutoff).length;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}
