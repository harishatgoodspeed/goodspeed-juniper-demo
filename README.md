# Goodspeed Brand OS — free tool

A public, free tool: paste a URL, confirm the brand we found, and download
three different posts (a carousel PDF, a saveable image, and a proof led
post or a text fallback). Each one has a caption, alt text, and checks
against a source ledger taken from the page, not from the model's own fact
list. No signup, no login, and no email gate before download. Older runs
that produced the previous six files stay readable. Nothing here is deployed.

**Status: working end to end, verified live against a real site with a real
`ANTHROPIC_API_KEY`, not yet deployed.** Every visitor gets an isolated,
anonymous workspace automatically — there is no login step and no shared
access code any more. Daily spend caps (per-visitor and global, both
PLACEHOLDER values) gate every run. **Nothing in this repo has been
deployed.**

## Setup

```bash
npm install
npx playwright install chromium   # the renderer needs a real Chromium binary
cp .env.example .env              # fill in SESSION_SECRET and ANTHROPIC_API_KEY at minimum
npm run migrate
npm run build
npm start                          # or: npm run dev
```

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Open `http://localhost:3000` and paste a public site URL — a workspace is
provisioned silently on first visit, nothing to sign in to. Brief
generation and real copy/voice review need a real `ANTHROPIC_API_KEY` in
`.env`; without one, a run still goes exactly as far as it honestly can and
then fails clearly at the brief step, rather than faking a result.

## Tests

```bash
npm test
```

184 tests pass, and 1 is skipped when no local TTF fixture is present. They run offline under `node --env-file=.env.test`:
SSRF checks spin up real local HTTP servers to prove loopback/metadata
addresses are refused; the renderer's tests launch a real headless Chromium
and assert on real PNG/PDF bytes, real sampled pixel colours, and a real
embedded font file actually loading; the logo-fidelity tests render a real
reference image and prove a genuinely different asset scores low similarity,
not just that presence was checked; the deterministic wrong-palette-token
and mechanical-exclamation-point fixtures prove the repair loop fixes what
it claims to and leaves everything else honestly unresolved; the sharing
tests prove anonymous access actually works for a valid share token and
actually fails for a wrong one, a revoked one, or no token at all. `npm
test` mocks the Anthropic client (no key or real network access needed to
run it) — real API usage is exercised manually against a live site, see
below.

## The free journey

The default run is three post packages, not six files. Paste a URL, watch the
real import state (Reading your website, Finding your brand, Preparing your
ideas), confirm one brand card, then download a carousel PDF, a saveable
image, and a proof led post or a text fallback. UK or US spelling is an
explicit choice. The Goodspeed ladder appears only after something is ready,
and its button goes to https://goodspeed.studio/contact. Prices are not
invented here. Legacy runs with the older six outputs still open.

Spend caps reserve a placeholder estimate before work is queued and record
token usage from generation and review, including failures that returned
usage. Those dollar figures are placeholders, not a provider bill.

Anonymous brands and their files are deleted after `RETENTION_DAYS` (30 by
default). The server runs that purge when the process starts. Share pages and
zip manifests do not include email addresses. Rate limits are stored in
SQLite. The app does not trust `X-Forwarded-For`.

```
GET /                          → paste a URL, no account

POST /api/brands {url}
  → anonymous workspace auto-provisioned (no login) on first request
  → "import" job: SSRF-safe fetch, extraction, asset download+sanitise
  → approve logo/colours/fonts/voice via PATCH /api/brands/:id

GET /api/brands/:id/snapshot.md
  → a Claude-ready brand.md: approved palette/fonts/voice, zero contact

POST /api/brands/:id/check-upload {mimeType, imageBase64}
  → "check this against our brand": real pixel sampling, real CIEDE2000
    distance from each approved colour, colour only (see Known limitations)

POST /api/brands/:id/runs {task}
  → daily spend caps (per-visitor + global) checked first
  → "brief" job: Anthropic drafts one brief per output type — LinkedIn
    image, X image, Instagram image, post copy, one-pager, slide — every
    colour/font/asset reference independently re-validated against the
    approved context, UK/US spelling matched to the brand's own site
  → (on success) "generate" job: Playwright renders each brief to a real
    file, reviews it (CIEDE2000 colour, typography against a real embedded
    font file, logo presence AND pixel-fidelity against a reference render,
    real AI copy/voice assessment) and repairs a deterministic failure
    (wrong palette hex, the mechanical "no exclamation points" rule) by
    re-rendering, up to 2 attempts
  → run status becomes "completed" (every output passed) or "partial"
    (something stayed unresolved after repair — never silently hidden)

GET /api/runs/:id          → run + every output + its honest label
                              (Draft / Brand approved / Needs review) +
                              every review's findings
GET /api/outputs/:id/file  → the rendered file, full resolution, no
                              watermark, ownership-checked

POST /api/brands/:id/leads  → optional, post-delivery: email, preferred
                               tool, notes, explicit consent — notifies
                               Slack if SLACK_WEBHOOK_URL is set, never
                               required to use anything above

POST /api/brands/:id/share           → owner enables sharing; the raw token
                                        is returned once and never again
GET  /api/brands/:id/shares          → owner lists active share links
DELETE /api/brands/:id/share/:shareId → owner revokes one, effective immediately
GET /b/:id[?token=...]               → the result page: owner session or a
                                        valid share token, nothing else
```

### Verified end to end (manually, with a real `ANTHROPIC_API_KEY`)

Imported `https://goodspeed.studio`, approved a real logo + real colours +
real fonts + voice guidance, generated posts, and confirmed live: voice
notes save and restore, the brand snapshot downloads with the real approved
values, the upload-check returns real per-colour matches against a
synthetic test image, and a full run renders real LinkedIn/X/Instagram
images plus a post caption, a one-pager, and a slide — all through the
grouped free-journey UI, with working Draft/Brand approved/Needs review
labels, the "More formats" disclosure, the upsell panel, and the lead form.

Several real bugs were found and fixed along the way, not by `npm test`:

1. **Forced tool use is a 400 on Claude Sonnet 5.5.** Fixed by switching to
   `client.messages.parse()` with `output_config.format: zodOutputFormat(...)`,
   keeping an explicit `safeParse` re-validation afterwards so a misbehaving
   or mocked client still can't skip it.
2. **Colour/typography review could report a tautological "pass"** against
   the renderer's own internal fallback default when nothing had actually
   been approved. Fixed with an `expectedHexApproved`/`expectedFamilyApproved`
   flag that forces `not_applicable` instead of a fabricated pass.
3. **Logos and supporting images never actually rendered, in any output,
   ever.** Chromium refuses to load a local `file://` image from a document
   built via `page.setContent()` (no `file://` origin of its own) — it fails
   silently, no error, no exception, and the old logo check only verified a
   non-empty CSS bounding box, which every template sets inline regardless
   of whether the image decoded. Fixed at the root: the renderer now writes
   the template to a real temp file and navigates to it (`page.goto`)
   instead, giving the document a genuine `file://` origin. Caught only
   because the new logo-fidelity check's `naturalWidth`/`naturalHeight`
   assertion failed in a real Playwright test — not by any prior check.
4. **The new Instagram/X output types would have failed a database
   constraint** the first time a real run tried to use them — the original
   schema's `CHECK (type IN (...))` on `outputs.type` still named only the
   original four types. Fixed with a migration that rebuilds the table
   (SQLite can't alter a CHECK constraint in place) and a test that actually
   inserts all six types against a real migrated schema.

## What's implemented

- **Anonymous per-visitor workspaces.** No login, no access code: a new
  session silently provisions an isolated owner on first request
  (`attachSession`), rate-limited (20 new workspaces/hour/IP) so this can't
  be used to spin up unlimited free workspaces. "Start over" abandons the
  current one; the next request gets a brand-new one.
- **Daily spend caps.** `PER_VISITOR_DAILY_SPEND_USD` and
  `GLOBAL_DAILY_SPEND_USD` (both PLACEHOLDER) are checked before every run,
  estimated from real token usage at Claude Sonnet 5.5 list pricing
  (`estimateUsdCost`).
- **Import**: fetch exactly one HTML page plus up to 10 linked stylesheets
  (25 MB / 30 s budget total), under full SSRF protection — hostname and
  every redirect target are freshly resolved and checked against disallowed
  IP ranges, and the connection is made to the validated IP literal (never
  the hostname again) to close the DNS-rebinding window. `robots.txt` is
  checked before fetching. Logo candidates, colour declarations, CSS custom
  properties, fonts, and a bounded readable-copy excerpt are extracted with
  every gap recorded as an explicit "unknown".
- **Approval, including voice.** One logo, a colour list, a font list, and
  freeform voice guidance (`PATCH /api/brands/:id`) — each `setApprovedContext`
  call bumps `approved_context_version`, which drives the brand-versioning
  labels below.
- **Six coordinated output types per run**: `linkedin_image` (1200×627),
  `x_image` (1200×675, the same two-column layout), `instagram_image`
  (1080×1080, centred/stacked), `one_pager_pdf` (A4), `slide` (1280×720),
  and `post_copy`. Briefs are drafted via the Anthropic SDK with structured
  output, Zod-validated, then every `paletteTokenHexes`/`fontFamilies`/
  `logoAssetId` reference is independently re-checked against what was
  actually approved — an invented reference is rejected, not trusted.
  UK/US spelling is matched to the brand's own extracted copy
  (`detectEnglishVariant`), defaulting honestly to British English when no
  decisive signal is found.
- **Real font embedding.** Approved fonts are resolved to a real,
  downloadable file (a direct `@font-face` URL captured at import time, or
  the brand's own Google Fonts link) and embedded as a `data:` URI
  `@font-face` in the render — through the same SSRF-guarded fetch used for
  logos/images. A font with no real file behind it still fails typography
  review honestly; nothing is fabricated.
- **Real logo fidelity, beyond presence.** The logo check now requires the
  image to have actually decoded (`naturalWidth`/`naturalHeight` > 0, not
  just a non-empty CSS box) and visually match an independent reference
  render of the same approved file, compared pixel-for-pixel
  (`src/generate/logo-fidelity.ts`) — catching a wrong, substituted, or
  corrupted asset that still happens to decode.
- **Real AI copy/voice review**, not a stub: `assessCopy` checks generated
  copy's facts against only what was sourced and its voice against the
  approved guidance, via a real Anthropic call (dependency-injected for
  tests). A `not_verified` copy check now blocks `overallPass` by default
  (`requireCopyVerified`), same as any other unverified check.
- **A repair loop that fixes two real, deterministic failure modes**: a
  wrong palette hex (swap for the approved one and re-render) and the
  mechanical "no exclamation points" copy rule (strip it, no LLM call, no
  extra spend). Everything else the model actually had to judge — an
  invented claim, a voice mismatch, typography, logo fidelity — is left
  honestly unresolved rather than silently retried.
- **Honest, no-opaque-score labelling tied to brand versioning.** Every
  output is "Brand approved" only when every applicable check genuinely
  passed, "Draft" otherwise, or "Needs review" the moment the brand's
  approved context has moved on since that output was generated
  (`run.context_version !== brand.approved_context_version`).
- **Brand snapshot download** (`GET /api/brands/:id/snapshot.md`): a
  Claude-ready `brand.md` with the approved palette/fonts/voice and what was
  actually extracted about the brand, nothing invented, free, no email.
- **Upload-and-check, colour only.** `POST /api/brands/:id/check-upload`
  decodes a real uploaded image (any format a browser can decode — PNG,
  JPEG, WebP, GIF, via a real Chromium canvas, no new dependency), samples
  its real pixels, and reports a genuine CIEDE2000 distance from each
  approved colour to its closest real pixel. Deliberately never claims to
  check fonts or logo fidelity in an upload — see Known limitations.
- **Upsell panel and optional lead capture.** Shown only after a run
  completes or goes partial: a three-tier CTA (free starter, built into
  your tools, ongoing upkeep — no prices) linking to
  `https://goodspeed.studio/contact`, and an optional email-capture form
  (email, preferred tool, notes, explicit consent) that notifies
  `SLACK_WEBHOOK_URL` if configured and never blocks the lead being stored
  if Slack is down.
- **Jobs**: a persistent SQLite queue with a bounded-concurrency worker
  (`MAX_CONCURRENT_JOBS`, default 2). Each phase enqueues the next on
  success (`import` → ready; `brief` → `generate`, which does render+review
  inline — see Known limitations).
- **Rate limits**: 5 imports/hour, 3 runs/hour, 10 upload-checks/hour, and
  5 lead submissions/hour, all per owner; 20 new workspaces/hour per IP;
  `DAILY_RUN_LIMIT` (default 20) runs per rolling 24h globally, on top of
  the spend caps; one active run per owner at a time.
- **Static serving**: the app's own frontend is served through a
  from-scratch static file handler with correct MIME types, GET/HEAD,
  path-traversal protection, and a plain 404 for anything missing.
- **Sharing & the result page**: `GET /b/:id` is a server-rendered page
  (the task, the approved brand, the briefs, every output with its
  preview/download and honest label, its full review findings table),
  private by default — it checks the owner's session or a valid share token
  and 404s identically for "wrong token" and "brand doesn't exist"
  (existence is never confirmed to someone without access). Share tokens
  are high-entropy (256-bit); only their SHA-256 hash is ever stored, so the
  raw token is shown exactly once. `X-Robots-Tag: noindex, nofollow` is set
  on the page.

## What's NOT built yet

- **Fonts/logo fidelity in an upload check.** `check-upload` is colour only,
  deliberately (see Known limitations) — it has no font or logo detection.
- **Deletion** exists for brands (`DELETE /api/brands/:id`, which cascades
  to its shares/leads); there's no retention-cleanup job yet
  (`RETENTION_DAYS` is parsed, not enforced).
- **Docker** — this dev machine has no local Docker to build/test an image
  against, so none was written speculatively.
- **Share expiry** — `shares.expires_at` exists in the schema and
  `isValidShareToken` already honours it, but nothing in the API sets an
  expiry yet; a share is revocable but doesn't currently expire on its own.
- **Rate limiting still doesn't coordinate across multiple instances** — it's
  in-process memory, resets on restart.
- **A CI pipeline with mocked paid APIs, broader fuzzing, etc.** is not set up.

## Known limitations (disclosed, not hidden)

- **The upload-check is colour only.** Identifying a typeface or logo from
  an arbitrary rasterised upload (a screenshot, an exported design, a photo)
  isn't something this project can do reliably, and claiming to would be
  exactly the kind of fabricated capability this codebase otherwise refuses
  to ship. `UPLOAD_COLOUR_MATCH_THRESHOLD` (default 12 ΔE) is deliberately
  more lenient than the render-review threshold, since an upload may be a
  photo or re-compressed export this project doesn't control the exactness of.
- **The free journey generates one brief per output type (6), not "3-5
  variations of one type."** The six types (LinkedIn/X/Instagram images,
  post copy, one-pager, slide) are deliberately varied rather than
  near-duplicates of the same platform — the one-pager and slide are
  collapsed behind a "More formats" disclosure in the UI per the brief's
  "keep behind the scenes" instruction, but they're still generated,
  reviewed, and spend-capped the same as everything else.
- **Render + review share one job phase.** The `jobs` table's schema already
  allows a separate `"review"` phase, but `RenderEvidence` has no column to
  persist it between jobs in the current schema — serialising it would mean
  a new migration. `run-generate-job.ts` renders *and* reviews each output
  in one job, immediately, rather than inventing that storage mid-integration.
- **`outputs.file_id` stores an absolute local path directly**, not a
  foreign key into a dedicated files table. Access is still
  ownership-checked through `GET /api/outputs/:id/file`, never served as a
  static path — but this is a simplification worth revisiting if outputs
  need to move between machines/storage backends.
- **`paletteTokenHexes`/`fontFamilies` have a positional convention**
  ([background, primary, text, accent] / [heading, body]) that the brief
  prompt tells the model about and the renderer assumes. It's documented in
  both files' comments, not enforced by the type system.
- **Re-rendering during repair launches a fresh Chromium process per
  attempt** (correct per the "fresh isolated context" requirement, slower
  than reusing one browser — a deliberate trade-off, not an oversight). The
  same is true of the logo-fidelity reference render and the upload-check
  decode: each spins up its own isolated browser/context rather than
  sharing one across a request, for the same reason.
- **Font/logo-reference fetches have no persistent cache.** Real font files
  and the logo-fidelity reference render are fetched/rendered fresh per run
  (fonts) or per logo check (reference render), not cached to disk across
  runs — correct and safe, but means repeat runs for the same brand refetch
  the same font files.
- **Rate limiting is in-process memory.** Resets on restart; does not
  coordinate across multiple instances.
- **CSS extraction doesn't resolve `var()`.** A declaration driven entirely
  by a custom property is left unextracted rather than guessed at.
- **`robots.txt` parsing is minimal** — exact-prefix `Disallow`/`Allow` only.
- **SVG sanitisation is conservative, not exhaustive** — adequate for a free
  tool at this stage, not a substitute for a maintained sanitiser at wider
  exposure.
- **Named CSS colours aren't counted** (e.g. `tomato`) — only hex and
  `rgb()`/`rgba()`.

## Environment variables

See `.env.example` for the full list with descriptions. All of `PORT`,
`NODE_ENV`, `APP_BASE_URL`, `DATABASE_PATH`, `ASSET_DIR`, `SESSION_SECRET`,
`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `MAX_CONCURRENT_JOBS`,
`DAILY_RUN_LIMIT`, `MAX_RUN_TOKENS`, `COLOUR_DELTA_E_THRESHOLD`,
`LOGO_SIMILARITY_THRESHOLD`, `UPLOAD_COLOUR_MATCH_THRESHOLD`,
`RETENTION_DAYS`, `PER_VISITOR_DAILY_SPEND_USD`, `GLOBAL_DAILY_SPEND_USD`,
and `SLACK_WEBHOOK_URL` are read in `src/config.ts`.

## Project layout

```
src/
  config.ts, pipeline-types.ts   env parsing; shared Brief/RenderEvidence/
                                  ReviewResult contracts across the pipeline
  db.ts, migrate.ts               SQLite connection + migration runner
  ids.ts, brands.ts, runs.ts, outputs.ts, shares.ts, leads.ts   DB repositories
  jobs.ts                         persistent job queue + bounded worker
  llm.ts                          Anthropic brief generation + reference validation
  english-variant.ts              UK/US spelling detection for generated copy
  snapshot.ts                     the free-tool brand.md builder
  slack.ts                        lead-capture Slack webhook notifier
  share-page.ts                   server-rendered /b/:id HTML
  static-files.ts                 from-scratch static file serving
  security/   url.ts (SSRF), session.ts, auth-middleware.ts (anonymous
              workspace provisioning), cookies.ts, csrf.ts, rate-limit.ts,
              brand-access.ts (owner-or-share-token check)
  import/     fetch.ts, robots.ts, extract.ts, assets.ts, svg-sanitize.ts,
              run-import-job.ts
  generate/   templates.ts, render.ts, font-assets.ts (real font-file
              embedding), logo-fidelity.ts (reference-render comparison),
              network-guard.ts (shared file://-only Playwright guard)
  review/     colour.ts (CIEDE2000), review.ts, repair.ts,
              copy-assessment.ts (real AI copy/voice check),
              upload-check.ts (free-tool colour-only upload review)
  jobs/       run-brief-job.ts, run-generate-job.ts
  server.ts   Express app + routes
migrations/   0001_init.sql (full schema), 0002 (adds instagram_image/
              x_image to outputs.type), 0003 (leads table)
public/       the app's own frontend: import/approve/voice, generate posts,
              upload-check, sharing, upsell + lead capture (vanilla HTML/CSS/JS)
tests/        167 node:test tests (see "Tests" above)
```
