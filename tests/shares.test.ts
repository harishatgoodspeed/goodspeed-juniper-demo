import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestDb } from "../src/db";
import { createBrand } from "../src/brands";
import { getOrCreateDefaultOwner } from "../src/security/session";
import { createShare, isValidShareToken, listActiveSharesForBrand, revokeShare } from "../src/shares";

function setUp() {
  const db = openTestDb();
  const ownerId = getOrCreateDefaultOwner(db);
  const brand = createBrand(db, ownerId, "https://example.com");
  return { db, brand };
}

test("a freshly created share token is valid for its brand", () => {
  const { db, brand } = setUp();
  const { token } = createShare(db, brand.id);
  assert.equal(isValidShareToken(db, brand.id, token), true);
});

test("the raw token is never recoverable from storage — only its hash is kept", () => {
  const { db, brand } = setUp();
  const { share, token } = createShare(db, brand.id);
  assert.notEqual(share.token_hash, token);
  assert.equal(share.token_hash.length, 64); // sha256 hex
});

test("a token is only valid for the brand it was created for", () => {
  const { db, brand } = setUp();
  const ownerId = getOrCreateDefaultOwner(db);
  const otherBrand = createBrand(db, ownerId, "https://other.example");
  const { token } = createShare(db, brand.id);
  assert.equal(isValidShareToken(db, otherBrand.id, token), false);
});

test("an empty or garbage token is never valid", () => {
  const { db, brand } = setUp();
  createShare(db, brand.id);
  assert.equal(isValidShareToken(db, brand.id, ""), false);
  assert.equal(isValidShareToken(db, brand.id, "not-a-real-token"), false);
});

test("a revoked token stops being valid immediately", () => {
  const { db, brand } = setUp();
  const { share, token } = createShare(db, brand.id);
  assert.equal(isValidShareToken(db, brand.id, token), true);
  revokeShare(db, share.id);
  assert.equal(isValidShareToken(db, brand.id, token), false);
});

test("listActiveSharesForBrand excludes revoked shares", () => {
  const { db, brand } = setUp();
  const a = createShare(db, brand.id);
  const b = createShare(db, brand.id);
  revokeShare(db, a.share.id);
  const active = listActiveSharesForBrand(db, brand.id);
  assert.equal(active.length, 1);
  assert.equal(active[0].id, b.share.id);
});

test("an expired share is treated as invalid even without explicit revocation", () => {
  const { db, brand } = setUp();
  const { share, token } = createShare(db, brand.id);
  db.prepare("UPDATE shares SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(share.id);
  assert.equal(isValidShareToken(db, brand.id, token), false);
  assert.equal(listActiveSharesForBrand(db, brand.id).length, 0);
});
