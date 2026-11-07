import { test } from "node:test";
import assert from "node:assert/strict";
import { SlidingWindowLimiter } from "../src/security/rate-limit";

test("SlidingWindowLimiter allows up to the limit then blocks", () => {
  const limiter = new SlidingWindowLimiter(3, 60_000);
  const now = 1_000_000;
  assert.equal(limiter.check("ip1", now), true);
  assert.equal(limiter.check("ip1", now + 1), true);
  assert.equal(limiter.check("ip1", now + 2), true);
  assert.equal(limiter.check("ip1", now + 3), false, "4th attempt within the window should be blocked");
});

test("SlidingWindowLimiter tracks keys independently", () => {
  const limiter = new SlidingWindowLimiter(1, 60_000);
  const now = 1_000_000;
  assert.equal(limiter.check("a", now), true);
  assert.equal(limiter.check("b", now), true, "a different key must not be affected by another key's usage");
  assert.equal(limiter.check("a", now), false);
});

test("SlidingWindowLimiter forgets hits once they age out of the window", () => {
  const limiter = new SlidingWindowLimiter(1, 1000);
  const now = 1_000_000;
  assert.equal(limiter.check("a", now), true);
  assert.equal(limiter.check("a", now + 500), false);
  assert.equal(limiter.check("a", now + 1001), true, "hit should have aged out after the window");
});
