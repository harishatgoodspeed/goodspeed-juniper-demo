import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestDb } from "../src/db";
import { createAnonymousOwner } from "../src/security/session";
import { createBrand } from "../src/brands";
import { createRun } from "../src/runs";
import { createOutput, getOutput } from "../src/outputs";

/**
 * Migration 0002 widened outputs.type's CHECK constraint to allow
 * instagram_image/x_image (added alongside linkedin_image in
 * src/pipeline-types.ts's OutputType). Before that migration, creating
 * either would throw a SQLite CHECK constraint violation the first time a
 * real run actually tried to persist one — this proves it no longer does,
 * against a real on-disk schema (openTestDb runs every migration file).
 */
test("outputs.type accepts instagram_image and x_image after migration 0002, not just the original four types", () => {
  const db = openTestDb();
  const ownerId = createAnonymousOwner(db);
  const brand = createBrand(db, ownerId, "https://example.com");
  const run = createRun(db, brand.id, "Launch post", null, 0);

  for (const type of ["linkedin_image", "x_image", "instagram_image", "one_pager_pdf", "slide", "post_copy"] as const) {
    const output = createOutput(db, run.id, type, "{}");
    assert.equal(getOutput(db, output.id)?.type, type);
  }
});
