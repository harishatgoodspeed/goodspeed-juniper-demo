// NODE_ENV=test (and the rest) comes from .env.test, loaded via `node
// --env-file=.env.test` in the "test" npm script — not by assigning
// process.env in this file. TypeScript/tsx can evaluate a file's static
// imports before later top-level statements run, so an in-file
// `process.env.X = ...` placed "before" an import is not reliably seen by
// config.ts, which reads process.env once at import time. --env-file sets
// the environment before the process (and so any module) starts at all.
// With NODE_ENV=test, config.ts itself falls back to known test constants
// for APP_ACCESS_CODE/SESSION_SECRET — asserted against directly below.

import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config";
import { openTestDb } from "../src/db";
import { accessCodeMatches, sign, verifySigned, createSession, getValidSession, getOrCreateDefaultOwner } from "../src/security/session";

test("test environment is wired correctly (sanity check for the rest of this file)", () => {
  assert.equal(config.NODE_ENV, "test");
  assert.equal(config.APP_ACCESS_CODE, "test-access-code");
});

test("accessCodeMatches accepts only the exact configured code", () => {
  assert.equal(accessCodeMatches("test-access-code"), true);
  assert.equal(accessCodeMatches("wrong"), false);
  assert.equal(accessCodeMatches(""), false);
  assert.equal(accessCodeMatches("test-access-cod"), false); // one char short
});

test("sign/verifySigned round-trips and rejects tampering", () => {
  const signed = sign("session-id-123");
  assert.equal(verifySigned(signed), "session-id-123");

  const tampered = signed.replace(/.$/, (c) => (c === "a" ? "b" : "a"));
  assert.equal(verifySigned(tampered), null);

  assert.equal(verifySigned("garbage-no-dot-separator-of-the-right-shape"), null);
  assert.equal(verifySigned(""), null);
});

test("sign/verifySigned with a different secret does not validate", () => {
  const signed = sign("session-id-123", "secret-a-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(verifySigned(signed, "secret-b-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), null);
});

test("sessions: created sessions validate, expired ones do not", () => {
  const db = openTestDb();
  const ownerId = getOrCreateDefaultOwner(db);
  const session = createSession(db, ownerId);
  assert.ok(getValidSession(db, session.id));

  // Force-expire it directly and confirm it's then treated as invalid and cleaned up.
  db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(session.id);
  assert.equal(getValidSession(db, session.id), undefined);
  const stillThere = db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(session.id);
  assert.equal(stillThere, undefined, "expired session row should be cleaned up on read");
});

test("getOrCreateDefaultOwner is idempotent", () => {
  const db = openTestDb();
  const a = getOrCreateDefaultOwner(db);
  const b = getOrCreateDefaultOwner(db);
  assert.equal(a, b);
  const count = db.prepare("SELECT count(*) as n FROM owners").get() as { n: number };
  assert.equal(count.n, 1);
});
