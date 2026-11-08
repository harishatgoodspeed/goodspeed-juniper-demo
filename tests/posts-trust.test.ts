import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { PNG } from "pngjs";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server";
import { runMigrations } from "../src/db";
import { openTestDb } from "../src/db";
import { createAnonymousOwner } from "../src/security/session";
import { createBrand, setApprovedContext, setBrandContext } from "../src/brands";
import { createRun, getRun } from "../src/runs";
import { createOutput } from "../src/outputs";
import { buildSourceLedger, unsupportedNumericTokens, verifyCitedClaims } from "../src/ledger";
import { reviewOutput, computeOverallPass } from "../src/review/review";
import { assessCopy } from "../src/review/copy-assessment";
import { tryReserve } from "../src/spend";
import { config } from "../src/config";
import { buildZip, readZipEntry } from "../src/zip-safe";
import { buildPostZip } from "../src/posts/package";
import { approvedImagePaths } from "../src/imagery";
import { normalisePostDrafts, PostDraftError } from "../src/posts/validate";
import { englishChoiceInstruction } from "../src/posts/validate";
import { pagesForDraft } from "../src/generate/post-templates";
import { postsSystemPrompt } from "../src/posts/concepts";
import { insertPost, listPostsForRun, type PostAssetRow } from "../src/posts/store";
import { editPostCopy, regenerateOnePost } from "../src/posts/mutate";
import { setRunLedger } from "../src/runs";
import { purgeExpiredBrands } from "../src/retention";
import type { Brief } from "../src/pipeline-types";
import type { PostDraft } from "../src/posts/types";
import type { BrandContext } from "../src/import/types";

function context(): BrandContext {
  return {
    sourceUrl: "https://example.com",
    fetchedAt: "2026-11-07T00:00:00.000Z",
    extractionMethod: "static-html-css",
    title: "Example boots",
    siteName: "Example",
    description: "Example Co repairs walking boots in a small workshop.",
    logoCandidates: [],
    colours: [],
    cssCustomProperties: [],
    fonts: [],
    googleFontsLinks: [],
    images: [],
    textExcerpt: "Example Co repairs walking boots in a small workshop.",
    textTruncated: false,
    stylesheetsFetched: 0,
    stylesheetsSkipped: 0,
    unknowns: [],
  };
}

function draft(family: PostDraft["formatFamily"], compositionId: string, pages: number): PostDraft {
  const page = (n: number) => ({ heading: `Point ${n} for walkers`, body: "Repair the boot before the sole splits." });
  return {
    formatFamily: family,
    compositionId,
    title: "How to keep a boot walking",
    hook: "Start with the sole you already have.",
    hookAlternatives: ["Start with the sole you already have.", "A workshop habit worth keeping."],
    caption: "Example Co repairs walking boots in a small workshop. Bring the pair in before the sole splits.",
    xCaption: "Boots fail at the sole first. Repair them before the split.",
    altText: "A short guide to repairing walking boots.",
    pages: Array.from({ length: pages }, (_, i) => page(i + 1)),
    claims: [
      {
        text: "Example Co repairs walking boots in a small workshop.",
        ledgerIds: ["L1"],
        kind: "fact",
      },
    ],
    imageAssetIds: [],
    rationale: "Useful and sourced.",
    cta: "Bring the pair in when you can.",
    paletteTokenHexes: ["#F4F1EA", "#1F3A2E", "#1C1C1C"],
    fontFamilies: ["Georgia"],
    logoAssetId: null,
  };
}

test("a fabricated figure is rejected even when the caption and the generated fact list both contain it", async () => {
  const ledger = buildSourceLedger({
    sourceUrl: "https://example.com",
    description: "We repair boots in the workshop.",
    textExcerpt: "We repair boots in the workshop.",
    retrievedAt: "2026-11-07T00:00:00.000Z",
  });
  const fake = "Revenue grew 400% in 2024";
  const brief: Brief = {
    outputType: "linkedin_image",
    purpose: "Announce",
    audience: "Walkers",
    sourcedFactualCopy: [fake],
    layoutDirection: "text",
    paletteTokenHexes: ["#F4F1EA"],
    fontFamilies: ["Georgia"],
    logoAssetId: null,
    imageAssetIds: [],
    voiceGuidance: "Plain.",
    unknowns: [],
  };
  let sawWhitelist = false;
  const result = await reviewOutput(
    {
      outputType: "linkedin_image",
      filePath: null,
      width: 1080,
      height: 1350,
      regions: [],
      fontChecks: [],
      logoCheck: null,
      overflow: false,
      text: `${fake}. We repair boots in the workshop.`,
      layout: { overflow: false, overlap: false, minBodyPx: 36, contrastRatio: 7, problems: [] },
    },
    brief,
    {
      ledger,
      copyAssessmentClient: {
        messages: {
          parse: async (params) => {
            const body = JSON.stringify(params);
            sawWhitelist = body.includes("Sourced facts this copy was allowed");
            return { parsed_output: { factsAreAllSourced: true, inventedOrUnsupportedClaims: [], matchesVoiceGuidance: true, voiceMismatchExplanation: "" } };
          },
        },
      },
    }
  );
  const copy = result.checks.find((check) => check.kind === "copy");
  assert.equal(copy?.status, "fail");
  assert.match(copy!.explanation, /400%/);
  assert.equal(sawWhitelist, false, "the auditor must not be given the model's own fact list");
  assert.equal(result.overallPass, false);
  assert.equal(computeOverallPass([]), false);
});

test("cited claims fail when the ledger id is real but the excerpt does not support the sentence", () => {
  const ledger = buildSourceLedger({
    sourceUrl: "https://example.com/about",
    description: "We repair boots in the workshop.",
    textExcerpt: "We repair boots in the workshop.",
    retrievedAt: "2026-11-07T00:00:00.000Z",
  });
  const verdict = verifyCitedClaims(
    [{ text: "Revenue grew 400% in 2024 after the rebrand", ledgerIds: [ledger[0].id], kind: "fact" }],
    ledger
  );
  assert.equal(verdict.ok, false);
  assert.equal(unsupportedNumericTokens("since 1998", "since 1998").length, 0);
});

test("explicit American English wins over a British looking site", () => {
  const line = englishChoiceInstruction("us");
  assert.match(line, /American English/);
  assert.match(line, /explicitly/);
});

test("a run needs a carousel, a checklist image, and a text hook", () => {
  const ledger = buildSourceLedger({
    sourceUrl: "https://example.com",
    description: "Example Co repairs walking boots in a small workshop.",
    textExcerpt: "Example Co repairs walking boots in a small workshop.",
    retrievedAt: "2026-11-07T00:00:00.000Z",
  });
  const base = {
    colours: ["#F4F1EA", "#1F3A2E", "#1C1C1C"],
    fonts: ["Georgia"],
    logoAssetId: null,
    approvedImageIds: [] as string[],
    ledger,
    channel: "linkedin" as const,
    englishVariant: "uk" as const,
    ownedImageCount: 0,
  };
  const posts = [
    draft("carousel", "carousel-steps", 6),
    draft("explainer", "explainer-framework", 4),
    draft("hook", "hook-text", 0),
  ];
  const normalised = normalisePostDrafts(posts, base);
  assert.equal(normalised.length, 3);
  assert.equal(normalised[2].compositionId, "hook-text");
  assert.deepEqual(normalised[2].pages, []);
  assert.deepEqual(normalised[2].imageAssetIds, []);
  assert.equal(normalised[2].logoAssetId, null);
  assert.equal(normalised[2].xCaption, "");
  assert.equal(normalised[2].altText, "");
  assert.throws(
    () => normalisePostDrafts([posts[0], posts[1], draft("explainer", "explainer-framework", 4)], base),
    /hook/
  );
  const comparison = draft("explainer", "explainer-comparison", 4);
  assert.equal(normalisePostDrafts([posts[0], comparison, posts[2]], base)[1].compositionId, "explainer-framework");
  const noisy = draft("hook", "text-pov", 3);
  noisy.imageAssetIds = ["not-an-approved-image"];
  noisy.logoAssetId = "logo_other";
  const cleaned = normalisePostDrafts([posts[0], posts[1], noisy], base);
  assert.equal(cleaned[2].compositionId, "hook-text");
  assert.deepEqual(cleaned[2].pages, []);
  assert.deepEqual(cleaned[2].imageAssetIds, []);
  assert.equal(cleaned[2].logoAssetId, null);
  const short = draft("carousel", "carousel-steps", 5);
  assert.throws(() => normalisePostDrafts([short, posts[1], posts[2]], base), /6 to 8/);
});

test("the draft prompt asks for the three LinkedIn formats and not an X post", () => {
  const prompt = postsSystemPrompt(3, "uk");
  assert.match(prompt, /carousel-steps/);
  assert.match(prompt, /carousel-checklist/);
  assert.match(prompt, /explainer-framework/);
  assert.match(prompt, /hook-text/);
  assert.match(prompt, /British English/);
  assert.doesNotMatch(prompt, /xCaption|proof-annotation|proof-split|text-pov|text-columns/);
});

test("compositions differ and none of them is a Learn more pill", () => {
  const assets = { imagePaths: [] as string[] };
  const steps = pagesForDraft(draft("carousel", "carousel-steps", 6), assets, "linkedin");
  const list = pagesForDraft(draft("carousel", "carousel-checklist", 6), assets, "linkedin");
  const framework = pagesForDraft(draft("explainer", "explainer-framework", 4), assets, "linkedin");
  const hook = pagesForDraft(draft("hook", "hook-text", 0), assets, "linkedin");
  const legacy = pagesForDraft(draft("proof" as PostDraft["formatFamily"], "proof-annotation", 3), assets, "x");
  assert.notEqual(steps[0].html, list[0].html);
  assert.equal(steps.length, 6);
  assert.equal(list.length, 6);
  assert.equal(framework.length, 1);
  assert.equal(framework[0].compositionId, "explainer-framework");
  assert.equal(framework[0].width, 1080);
  assert.equal(framework[0].height, 1350);
  assert.deepEqual(hook, []);
  assert.deepEqual(legacy, []);
  assert.match(steps[0].html, /carousel-steps/);
  assert.match(list[0].html, /carousel-checklist/);
  assert.match(framework[0].html, /Checklist/);
  const asX = pagesForDraft(draft("carousel", "carousel-steps", 6), assets, "x");
  assert.equal(asX[0].width, 1080);
  assert.equal(asX[0].height, 1350);
  assert.doesNotMatch(asX[0].html, /-x"/);
  for (const html of [steps[0].html, steps[5].html, list[0].html, list[3].html, framework[0].html]) {
    assert.equal(html.includes("Learn more"), false);
  }
  const dark = draft("explainer", "explainer-framework", 4);
  dark.paletteTokenHexes = ["#102018", "#F4F1EA", "#F4F1EA"];
  const light = draft("explainer", "explainer-framework", 4);
  assert.notEqual(pagesForDraft(dark, assets, "linkedin")[0].html, pagesForDraft(light, assets, "linkedin")[0].html);
});

test("owned images are wired through and scraped page images are not", () => {
  const db = openTestDb();
  const owner = createAnonymousOwner(db);
  const brand = createBrand(db, owner, "https://example.com");
  const owned = path.join(os.tmpdir(), `owned-${owner}.png`);
  fs.writeFileSync(owned, "png");
  db.prepare(
    `INSERT INTO owned_uploads (id, brand_id, local_path, mime_type, byte_size, width, height, ownership_confirmed)
     VALUES ('upload_1', ?, ?, 'image/png', 3, 10, 10, 1)`
  ).run(brand.id, owned);
  db.prepare(
    `INSERT INTO source_assets (id, brand_id, origin_url, kind, local_path, mime_type)
     VALUES ('asset_site', ?, 'https://example.com/pic.jpg', 'content_image', '/tmp/site.jpg', 'image/jpeg')`
  ).run(brand.id);
  const paths = approvedImagePaths(db, brand.id, ["upload_1", "asset_site"]);
  assert.deepEqual(paths, [owned]);
  fs.rmSync(owned, { force: true });
});

test("editing one post clears its checks and leaves the other post alone", () => {
  const db = openTestDb();
  const owner = createAnonymousOwner(db);
  const brand = createBrand(db, owner, "https://example.com");
  setBrandContext(db, brand.id, context());
  const run = createRun(db, brand.id, "Posts", null, 1, { mode: "posts", englishVariant: "uk", channel: "linkedin" });
  const ledger = buildSourceLedger({
    sourceUrl: "https://example.com",
    description: context().description,
    textExcerpt: context().textExcerpt,
    retrievedAt: context().fetchedAt,
  });
  setRunLedger(db, run.id, JSON.stringify(ledger));
  insertPost(db, { runId: run.id, position: 0, draft: draft("carousel", "carousel-steps", 6), channel: "linkedin", englishVariant: "uk", brandVersion: 1, formatNote: "Evergreen format", sourceRefs: [] });
  insertPost(db, { runId: run.id, position: 1, draft: draft("explainer", "explainer-framework", 4), channel: "linkedin", englishVariant: "uk", brandVersion: 1, formatNote: "Evergreen format", sourceRefs: [] });
  const [first, second] = listPostsForRun(db, run.id);
  db.prepare(`UPDATE posts SET status = 'ready', review_passed = 1, review_json = '[]', review_revision = revision, review_brand_version = brand_version WHERE id = ?`).run(first.id);
  const edited = editPostCopy(db, first.id, { caption: "Revenue grew 400% in 2024." });
  const sibling = listPostsForRun(db, run.id).find((row) => row.id === second.id)!;
  assert.equal(sibling.revision, second.revision);
  assert.equal(sibling.caption, second.caption);
  assert.equal(edited.review_passed, 0);
  assert.match(edited.review_json ?? "", /400%/);
});

test("regenerating one post does not change the other two", async () => {
  const db = openTestDb();
  const owner = createAnonymousOwner(db);
  const brand = createBrand(db, owner, "https://example.com");
  setBrandContext(db, brand.id, context());
  setApprovedContext(db, brand.id, { logoAssetId: null, colours: ["#F4F1EA"], fonts: ["Georgia"], voiceNotes: "" });
  const run = createRun(db, brand.id, "Posts", null, 1, { mode: "posts", englishVariant: "us", channel: "linkedin" });
  setRunLedger(db, run.id, "[]");
  const ids = ["carousel", "explainer", "hook"].map((family, index) =>
    insertPost(db, {
      runId: run.id,
      position: index,
      draft: draft(
        family as PostDraft["formatFamily"],
        family === "carousel" ? "carousel-steps" : family === "explainer" ? "explainer-framework" : "hook-text",
        family === "carousel" ? 6 : family === "explainer" ? 4 : 0
      ),
      channel: "linkedin",
      englishVariant: "us",
      brandVersion: 1,
      formatNote: "Evergreen format",
      sourceRefs: [],
    }).id
  );
  const before = listPostsForRun(db, run.id);
  const file = path.join(os.tmpdir(), `post-${ids[0]}.png`);
  fs.writeFileSync(file, "x");
  const replacement = draft("carousel", "carousel-checklist", 6);
  replacement.title = "A different carousel";
  await regenerateOnePost(db, ids[0], replacement, {
    renderPostPackage: async () => ({
      pages: [{ index: 0, filePath: file, width: 10, height: 10, text: replacement.caption, layout: { overflow: false, overlap: false, minBodyPx: 36, contrastRatio: 7, problems: [] } }],
      pdfPath: null,
      text: replacement.caption,
      compositionId: "carousel-checklist",
      layout: { overflow: false, overlap: false, minBodyPx: 36, contrastRatio: 7, problems: [] },
    }),
    resolveFontFaces: async () => new Map(),
  });
  const after = listPostsForRun(db, run.id);
  assert.equal(after[0].title, "A different carousel");
  assert.equal(after[1].revision, before[1].revision);
  assert.equal(after[2].caption, before[2].caption);
  assert.equal(getRun(db, run.id)?.english_variant, "us");
  fs.rmSync(file, { force: true });
});

test("legacy runs stay readable after the posts migration", () => {
  const db = openTestDb();
  const owner = createAnonymousOwner(db);
  const brand = createBrand(db, owner, "https://example.com");
  const run = createRun(db, brand.id, "Old", null, 0);
  assert.equal(getRun(db, run.id)?.mode, "legacy");
  const output = createOutput(db, run.id, "linkedin_image", "{}");
  assert.equal(output.type, "linkedin_image");
  const proof = insertPost(db, {
    runId: run.id,
    position: 0,
    draft: draft("proof" as PostDraft["formatFamily"], "text-pov", 3),
    channel: "linkedin",
    englishVariant: "uk",
    brandVersion: 1,
    formatNote: "Evergreen format",
    sourceRefs: [],
  });
  assert.equal(proof.format_family, "proof");
  const hook = insertPost(db, {
    runId: run.id,
    position: 1,
    draft: draft("hook", "hook-text", 0),
    channel: "linkedin",
    englishVariant: "uk",
    brandVersion: 1,
    formatNote: "Evergreen format",
    sourceRefs: [],
  });
  assert.equal(hook.format_family, "hook");
});

test("zip entry names cannot escape and the caption stays paired with the post", () => {
  assert.throws(() => buildZip([{ name: "../caption.txt", data: "nope" }]));
  const db = openTestDb();
  const owner = createAnonymousOwner(db);
  const brand = createBrand(db, owner, "https://example.com");
  const run = createRun(db, brand.id, "Posts", null, 1, { mode: "posts" });
  const post = insertPost(db, {
    runId: run.id,
    position: 0,
    draft: draft("explainer", "explainer-framework", 4),
    channel: "linkedin",
    englishVariant: "uk",
    brandVersion: 3,
    formatNote: "Evergreen format",
    sourceRefs: [],
  });
  const png = path.join(os.tmpdir(), `post-${post.id}.png`);
  fs.writeFileSync(png, "png");
  const asset = (kind: PostAssetRow["kind"], nameNote: number): PostAssetRow => ({
    id: `asset_${kind}_${nameNote}`,
    post_id: post.id,
    kind,
    page_index: kind === "pdf" || kind === "x_png" ? null : 0,
    file_path: png,
    width: 1080,
    height: 1350,
    mime_type: kind === "pdf" ? "application/pdf" : "image/png",
    byte_size: 3,
    created_at: "2026-11-08T00:00:00.000Z",
  });
  const zip = buildPostZip(post, [asset("png", 1), asset("x_png", 2)], [{ id: "L1", sourceUrl: "https://example.com" }]);
  assert.equal(readZipEntry(zip, "caption.txt")?.toString(), post.caption);
  assert.equal(readZipEntry(zip, "alt.txt")?.toString(), post.alt_text);
  assert.equal(readZipEntry(zip, "checklist.png")?.toString(), "png");
  assert.equal(readZipEntry(zip, "brand-version.txt")?.toString(), "3");
  assert.match(readZipEntry(zip, "sources.json")?.toString() ?? "", /example.com/);
  assert.doesNotMatch(readZipEntry(zip, "sources.json")?.toString() ?? "", /@/);
  assert.equal(readZipEntry(zip, "x-post.txt"), null);
  assert.equal(readZipEntry(zip, "x.png"), null);
  const hook = insertPost(db, {
    runId: run.id,
    position: 1,
    draft: draft("hook", "hook-text", 0),
    channel: "linkedin",
    englishVariant: "uk",
    brandVersion: 3,
    formatNote: "Evergreen format",
    sourceRefs: [],
  });
  const hookZip = buildPostZip(hook, [asset("png", 3), asset("pdf", 4), asset("x_png", 5)], [{ id: "L1", sourceUrl: "https://example.com" }]);
  assert.equal(readZipEntry(hookZip, "caption.txt")?.toString(), hook.caption);
  assert.equal(readZipEntry(hookZip, "hook.txt")?.toString(), hook.hook);
  assert.equal(readZipEntry(hookZip, "alt.txt"), null);
  assert.equal(readZipEntry(hookZip, "checklist.png"), null);
  assert.equal(readZipEntry(hookZip, "carousel.pdf"), null);
  assert.equal(readZipEntry(hookZip, "x-post.txt"), null);
  assert.equal(readZipEntry(hookZip, "x.png"), null);
  fs.rmSync(png, { force: true });
});

test("concurrent reservations cannot both pass a budget that only covers one", async () => {
  const file = path.join(os.tmpdir(), `spend-${Date.now()}.db`);
  const setup = new Database(file);
  runMigrations(setup);
  const room = config.PER_VISITOR_DAILY_SPEND_USD - config.RUN_RESERVATION_USD;
  setup.prepare(
    `INSERT INTO api_usage (id, owner_id, kind, prompt_tokens, completion_tokens, estimated_usd, status)
     VALUES ('spend_seed', 'owner_a', 'seed', 0, 0, ?, 'settled')`
  ).run(room);
  setup.close();
  const left = new Database(file);
  const right = new Database(file);
  left.pragma("busy_timeout = 5000");
  right.pragma("busy_timeout = 5000");
  const results = await Promise.all([
    Promise.resolve().then(() => tryReserve(left, { ownerId: "owner_a", kind: "run", usd: config.RUN_RESERVATION_USD })),
    Promise.resolve().then(() => tryReserve(right, { ownerId: "owner_a", kind: "run", usd: config.RUN_RESERVATION_USD })),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok).length, 1);
  left.close();
  right.close();
  fs.rmSync(file, { force: true });
});

test("expired anonymous brands are removed and share content has no email field", () => {
  const db = openTestDb();
  const owner = createAnonymousOwner(db);
  const brand = createBrand(db, owner, "https://example.com");
  db.prepare(`UPDATE brands SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`).run(brand.id);
  db.prepare(`INSERT INTO leads (id, brand_id, email, consent) VALUES ('lead_1', ?, 'person@example.com', 1)`).run(brand.id);
  const removed = purgeExpiredBrands(db, new Date("2026-11-07T00:00:00.000Z"), os.tmpdir());
  assert.deepEqual(removed, [brand.id]);
  const lead = db.prepare(`SELECT id FROM leads WHERE brand_id = ?`).get(brand.id);
  assert.equal(lead, undefined);
});

function noisyPng(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = (i * 17) % 255;
    png.data[i + 1] = (i * 9) % 255;
    png.data[i + 2] = (i * 3) % 255;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

function pngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24);
  buf.write("\x89PNG\r\n\x1a\n", 0, "binary");
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

async function start() {
  const { app, db } = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, db, base };
}

async function login(base: string) {
  const res = await fetch(`${base}/api/session`);
  const cookies = res.headers.getSetCookie().join("; ");
  const session = cookies.match(/gs_session=([^;]+)/)![1];
  const csrf = decodeURIComponent(cookies.match(/gs_csrf=([^;]+)/)![1]);
  return { cookie: `gs_session=${session}; gs_csrf=${csrf}`, csrf };
}

test("upload parser accepts a real image over 100kb, rejects oversize bodies, and refuses a pixel bomb before decode", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const created = await fetch(`${base}/api/brands`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ url: "https://example.com/about" }),
    });
    const { brand } = (await created.json()) as { brand: { id: string } };
    setBrandContext(db, brand.id, context());
    setApprovedContext(db, brand.id, { logoAssetId: null, colours: ["#112233"], fonts: [], voiceNotes: "" });
    db.prepare(`UPDATE brands SET status = 'ready' WHERE id = ?`).run(brand.id);

    const image = noisyPng(420, 420);
    assert.ok(image.length > 100 * 1024, `expected a payload over 100kb, got ${image.length}`);
    const ok = await fetch(`${base}/api/brands/${brand.id}/check-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ mimeType: "image/png", imageBase64: image.toString("base64") }),
    });
    assert.notEqual(ok.status, 413);
    assert.equal(ok.status, 200);

    const tight = await fetch(`${base}/api/brands`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ url: "https://example.com", padding: "x".repeat(120 * 1024) }),
    });
    assert.equal(tight.status, 413);

    const tooBig = await fetch(`${base}/api/brands/${brand.id}/check-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ mimeType: "image/png", imageBase64: "a".repeat(9 * 1024 * 1024) }),
    });
    assert.equal(tooBig.status, 413);

    const bomb = await fetch(`${base}/api/brands/${brand.id}/check-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ mimeType: "image/png", imageBase64: pngHeader(20000, 20000).toString("base64") }),
    });
    assert.equal(bomb.status, 400);
    const bombBody = (await bomb.json()) as { error: string };
    assert.equal(bombBody.error, "image_too_large");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("a visitor cannot download another visitor's post package", async () => {
  const { server, db, base } = await start();
  try {
    const first = await login(base);
    const created = await fetch(`${base}/api/brands`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: first.cookie, "X-CSRF-Token": first.csrf },
      body: JSON.stringify({ url: "https://example.com/about" }),
    });
    const { brand } = (await created.json()) as { brand: { id: string } };
    setBrandContext(db, brand.id, context());
    setApprovedContext(db, brand.id, { logoAssetId: null, colours: ["#F4F1EA"], fonts: ["Georgia"], voiceNotes: "" });
    const run = createRun(db, brand.id, "Posts", null, 1, { mode: "posts", englishVariant: "uk" });
    const post = insertPost(db, {
      runId: run.id,
      position: 0,
      draft: draft("hook", "hook-text", 0),
      channel: "linkedin",
      englishVariant: "uk",
      brandVersion: 1,
      formatNote: "Evergreen format",
      sourceRefs: [],
    });
    const second = await login(base);
    const res = await fetch(`${base}/api/posts/${post.id}/package.zip`, { headers: { Cookie: second.cookie } });
    assert.equal(res.status, 404);
    const own = await fetch(`${base}/api/posts/${post.id}/package.zip`, { headers: { Cookie: first.cookie } });
    assert.equal(own.status, 200);
    assert.match(own.headers.get("content-type") || "", /zip/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("the run stores an explicit spelling choice", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const created = await fetch(`${base}/api/brands`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ url: "https://example.com/colour" }),
    });
    const { brand } = (await created.json()) as { brand: { id: string } };
    setBrandContext(db, brand.id, context());
    setApprovedContext(db, brand.id, { logoAssetId: null, colours: ["#F4F1EA"], fonts: [], voiceNotes: "" });
    db.prepare(`UPDATE brands SET status = 'ready' WHERE id = ?`).run(brand.id);
    const res = await fetch(`${base}/api/brands/${brand.id}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ task: "Posts", englishVariant: "us" }),
    });
    assert.equal(res.status, 202);
    const body = (await res.json()) as { run: { id: string }; englishVariant: string };
    assert.equal(body.englishVariant, "us");
    assert.equal(getRun(db, body.run.id)?.english_variant, "us");
    assert.equal(getRun(db, body.run.id)?.mode, "posts");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("the copy auditor is shown ledger excerpts and not a model fact list", async () => {
  let prompt = "";
  await assessCopy(
    {
      sourcedFactualCopy: ["SECRET_WHITELIST_SENTENCE"],
      allowedSourceExcerpts: ["We repair boots in the workshop."],
      voiceGuidance: "Plain.",
      text: "We repair boots in the workshop.",
    },
    {
      client: {
        messages: {
          parse: async (params) => {
            prompt = JSON.stringify(params);
            return {
              parsed_output: {
                factsAreAllSourced: true,
                inventedOrUnsupportedClaims: [],
                matchesVoiceGuidance: true,
                voiceMismatchExplanation: "",
              },
              usage: { input_tokens: 11, output_tokens: 7 },
            };
          },
        },
      },
    }
  );
  assert.equal(prompt.includes("SECRET_WHITELIST_SENTENCE"), false);
  assert.equal(prompt.includes("We repair boots in the workshop."), true);
});
