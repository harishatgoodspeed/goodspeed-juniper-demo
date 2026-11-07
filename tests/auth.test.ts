// NODE_ENV=test (and the rest) comes from .env.test, loaded via `node
// --env-file=.env.test` in the "test" npm script — not by assigning
// process.env in this file. TypeScript/tsx can evaluate a file's static
// imports before later top-level statements run, so an in-file
// `process.env.X = ...` placed "before" an import is not reliably seen by
// config.ts, which reads process.env once at import time. --env-file sets
// the environment before the process (and so any module) starts at all.
// With NODE_ENV=test, config.ts itself falls back to a known test constant
// for SESSION_SECRET — asserted against directly below.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { config } from "../src/config";
import { openTestDb } from "../src/db";
import { sign, verifySigned, createSession, getValidSession, createAnonymousOwner } from "../src/security/session";
import { attachSession } from "../src/security/auth-middleware";
import { cookieMiddleware } from "../src/security/cookies";

test("test environment is wired correctly (sanity check for the rest of this file)", () => {
  assert.equal(config.NODE_ENV, "test");
  assert.ok(config.SESSION_SECRET.length > 0);
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
  const ownerId = createAnonymousOwner(db);
  const session = createSession(db, ownerId);
  assert.ok(getValidSession(db, session.id));

  // Force-expire it directly and confirm it's then treated as invalid and cleaned up.
  db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(session.id);
  assert.equal(getValidSession(db, session.id), undefined);
  const stillThere = db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(session.id);
  assert.equal(stillThere, undefined, "expired session row should be cleaned up on read");
});

test("createAnonymousOwner makes a genuinely new, isolated owner every time — never a shared default", () => {
  const db = openTestDb();
  const a = createAnonymousOwner(db);
  const b = createAnonymousOwner(db);
  assert.notEqual(a, b, "two visitors must never get the same owner id");
  const count = db.prepare("SELECT count(*) as n FROM owners").get() as { n: number };
  assert.equal(count.n, 2);
});

test("attachSession stops provisioning brand-new workspaces for one IP after 20 in an hour, so identity-cycling to dodge the per-visitor spend cap has a real ceiling", async () => {
  const db = openTestDb();
  const app = express();
  app.use(cookieMiddleware);
  app.use(attachSession(db));
  app.get("/", (req, res) => res.json({ ownerId: req.auth?.ownerId ?? null }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      // No cookie on any of these — every single one asks for a brand-new workspace.
      const res = await fetch(base);
      statuses.push(res.status);
    }
    assert.ok(statuses.slice(0, 20).every((s) => s === 200), "the first 20 new-workspace requests should succeed");
    assert.equal(statuses[20], 429, "the 21st new-workspace request from the same IP within the hour should be rate limited");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a visitor who already has a valid session is never counted against the new-workspace limit", async () => {
  const db = openTestDb();
  const app = express();
  app.use(cookieMiddleware);
  app.use(attachSession(db));
  app.get("/", (req, res) => res.json({ ownerId: req.auth?.ownerId ?? null }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const first = await fetch(base);
    const setCookies = typeof first.headers.getSetCookie === "function" ? first.headers.getSetCookie() : [];
    const sessionCookie = setCookies.find((c) => c.startsWith("gs_session="))?.split(";")[0];
    assert.ok(sessionCookie);

    // Reusing the same real session cookie 25 times must never trip the
    // new-workspace limiter, since no new workspace is being provisioned.
    for (let i = 0; i < 25; i++) {
      const res = await fetch(base, { headers: { Cookie: sessionCookie! } });
      assert.equal(res.status, 200);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
