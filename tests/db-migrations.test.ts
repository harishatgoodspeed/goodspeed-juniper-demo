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

test("posts.format_family accepts hook and still accepts legacy proof, and regenerate_count defaults to 0", () => {
  const db = openTestDb();
  const ownerId = createAnonymousOwner(db);
  const brand = createBrand(db, ownerId, "https://example.com");
  const run = createRun(db, brand.id, "Posts", null, 1, { mode: "posts", englishVariant: "uk", channel: "linkedin" });
  const insert = db.prepare(
    `INSERT INTO posts (
      id, run_id, position, format_family, composition_id, english_variant,
      title, hook, hook_alternatives_json, caption, alt_text,
      source_refs_json, claims_json, pages_json, palette_json, fonts_json, image_asset_ids_json, brand_version
    ) VALUES (?, ?, ?, ?, 'layout', 'uk', 'Title', 'Hook', '[]', 'Caption', 'Alt', '[]', '[]', '[]', '[]', '[]', '[]', 1)`
  );
  ["carousel", "explainer", "hook", "proof"].forEach((family, index) => {
    insert.run(`post_${family}`, run.id, index, family);
  });
  const hook = db.prepare(`SELECT format_family, regenerate_count FROM posts WHERE id = 'post_hook'`).get() as {
    format_family: string;
    regenerate_count: number;
  };
  assert.equal(hook.format_family, "hook");
  assert.equal(hook.regenerate_count, 0);
  const proof = db.prepare(`SELECT format_family FROM posts WHERE id = 'post_proof'`).get() as { format_family: string };
  assert.equal(proof.format_family, "proof");
});
