# Goodspeed Brand OS

Imports a real website's brand, drafts task briefs against it, renders real
downloadable assets, reviews them against the brand (with a bounded
auto-repair loop), and publishes a shareable, access-controlled result page.

**Status: Phases 1–5 built and tested, now verified end to end with a real
`ANTHROPIC_API_KEY` against a real site; Docker and deeper multi-instance
rate limiting are not built.** The whole pipeline — import a real site →
approve its brand → draft briefs with a real Anthropic call → render real
PNG/PDF assets → review with real CIEDE2000 colour checks and repair on
failure → publish a private-by-default result page the owner can share via
a revocable link — has been run end to end against `https://goodspeed.studio`
and produced real briefs, real rendered outputs, and genuine pass/fail
review findings. What's missing is documented plainly below, not glossed
over. **Nothing in this repo has been deployed.**

## Setup

```bash
npm install
npx playwright install chromium   # Phase 3 needs a real Chromium binary
cp .env.example .env              # fill in APP_ACCESS_CODE and SESSION_SECRET at minimum
npm run migrate
npm run build
npm start                          # or: npm run dev
```

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Open `http://localhost:3000`, sign in with `APP_ACCESS_CODE`, and paste a
public site URL to import its brand. Briefs (Phase 2) need a real
`ANTHROPIC_API_KEY` in `.env` — without one, the pipeline still runs exactly
as far as it honestly can and then fails clearly on the brief step (see
"Verified end to end" below), rather than faking a result.

## Tests

```bash
npm test
```

100 tests, entirely offline, running under `node --env-file=.env.test`:
SSRF checks spin up real local HTTP servers to prove loopback/metadata
addresses are refused; Phase 3's tests launch a real headless Chromium and
assert on real PNG/PDF bytes; Phase 4's deterministic wrong-palette-token
fixture computes a real CIEDE2000 ΔE; Phase 5's tests prove anonymous access
actually works for a valid share token and actually fails for a wrong one, a
revoked one, or no token at all; two tests (added after the live run below)
prove a colour/font check reports `not_applicable`, never a fabricated
`pass`, when the renderer used its own internal fallback instead of an
approved value. `npm test` still mocks the Anthropic client and the network
import (no key or real network access needed to run it) — those are
exercised against the real services manually, see below.

## The pipeline

```
POST /api/brands {url}
  → "import" job: SSRF-safe fetch, extraction, asset download+sanitise
  → owner approves logo/colours/fonts via PATCH /api/brands/:id

POST /api/brands/:id/runs {task}
  → "brief" job: Anthropic drafts 4 briefs, every colour/font/asset
    reference independently re-validated against the approved context
  → (on success) "generate" job: for each brief, Playwright renders a real
    PNG/PDF, then reviews it (CIEDE2000 colour, typography, logo presence,
    copy) and repairs an actionable colour failure by re-rendering, up to
    2 attempts
  → run status becomes "completed" (all outputs passed) or "partial"
    (something stayed unresolved after repair — never silently hidden)

GET /api/runs/:id          → run + every output + every review's findings
GET /api/outputs/:id/file  → the rendered PNG/PDF, ownership-checked

POST /api/brands/:id/share           → owner enables sharing; the raw token
                                        is returned once and never again
GET  /api/brands/:id/shares          → owner lists active share links
DELETE /api/brands/:id/share/:shareId → owner revokes one, effective immediately
GET /b/:id[?token=...]               → the result page: owner session or a
                                        valid share token, nothing else
```

### Verified end to end (manually, not part of `npm test`)

**Without an `ANTHROPIC_API_KEY`**: imported `https://goodspeed.studio`
(status `ready`, zero unknowns, its real palette and font stack extracted,
real logo/og-image/favicon downloaded and sanitised), created a run, and
watched it fail cleanly at the brief step with `"ANTHROPIC_API_KEY is not
configured — set it in .env to generate real briefs."` — the run's status
became `failed` and the job recorded that exact error. No pretend briefs, no
fake output.

**With a real `ANTHROPIC_API_KEY`**: the same brand, with a real logo + 3
real colours + 2 real fonts approved, ran a real end-to-end run —
`generateBriefs` made a real call to Claude Sonnet 5.5, Playwright rendered
real PNG/PDF files for all 4 output types, and `reviewOutput` produced real
findings:

- Colour checks genuinely **passed** (real CIEDE2000 ΔE 0.00) against the
  actual approved hexes.
- Typography checks genuinely **failed** — the approved fonts (proprietary
  webfonts) have no local `@font-face` file available to the
  network-isolated renderer, so the browser truthfully fell back to Georgia
  /Arial and the review reported that fallback as a failure rather than
  masking it. Loading approved custom webfonts into the renderer is real,
  not-yet-built work (see Known limitations).
- The logo check reported `not_verified` (no render evidence yet wired for
  that asset) and the copy check `not_verified` (Phase 2+ AI assessment
  still a stub) — both honest, neither a fabricated pass.

Two real bugs were found and fixed by this live run, not by `npm test`:

1. **Forced tool use is a 400 on Claude Sonnet 5.5.** `generateBriefs` used
   `tool_choice: {type: "tool", name: ...}` to force structured JSON out of
   the model — a pattern this model's API rejects outright
   (`tool_choice: type "tool" and "any" are not supported for this model`).
   Fixed by switching to `client.messages.parse()` with
   `output_config.format: zodOutputFormat(...)` (the SDK's own recommended
   replacement for "forced tool call that only existed to get JSON back"),
   keeping an explicit `BriefsToolInput.safeParse` re-validation afterwards
   so a misbehaving or mocked client still can't skip it.
2. **Colour/typography review could report a tautological "pass".** When no
   colour or font was approved for a role, the renderer (by design) falls
   back to an internal neutral default (`templates.ts`'s `DEFAULT_PALETTE`,
   or Georgia/Arial) so it can still render something. The review then
   sampled the rendered pixels and compared them against that *same*
   internal default — guaranteed to match, since nothing else drove the
   render — and reported "pass... matches the approved colour" even though
   nothing had actually been approved. `RenderRegion`/`FontCheckEvidence`
   now carry an `expectedHexApproved`/`expectedFamilyApproved` flag set by
   the template that built them; `reviewOutput` reports `not_applicable`
   instead of a fabricated pass whenever that flag is false.

## What's implemented

- **Import (Phase 1)**: fetch exactly one HTML page plus up to 10 linked
  stylesheets (25 MB / 30 s budget total), under full SSRF protection —
  hostname and every redirect target are freshly resolved and checked against
  disallowed IP ranges, and the connection is made to the validated IP
  literal (never the hostname again) to close the DNS-rebinding window.
  `robots.txt` is checked before fetching. Logo candidates (favicon,
  og:image, header `<img>`/`<svg>`, deduplicated), colour declarations
  (counted by how many declarations used them, not a visual-prominence
  claim), CSS custom properties, fonts, and a bounded readable-copy excerpt
  are extracted with every gap recorded as an explicit "unknown". Up to 5
  logo-ish candidates are downloaded, MIME/size-validated, and SVGs sanitised.
- **Briefs (Phase 2)**: `POST /api/brands/:id/runs` drafts 4 coordinated
  briefs (LinkedIn image, one-pager, slide, post copy) via the Anthropic SDK
  using forced tool-use for structured output, Zod-validated, and then —
  independently of the model's own output — every `paletteTokenHexes` hex,
  `fontFamilies` entry, and `logoAssetId` is checked against what was
  actually approved; any invented reference is rejected, not trusted. Real
  token usage and elapsed time (`process.hrtime.bigint()`) are recorded.
- **Rendering (Phase 3)**: Playwright renders each brief to a real asset in
  an isolated, network-blocked browser context (only `file:`/`data:`
  requests are allowed through) — a LinkedIn PNG (1200×627), a one-pager PDF
  (A4), a slide PNG (1280×720); post copy is just the brief's text, no
  render needed. Captures real evidence: computed font families (via a
  canvas measurement, since headless Chromium's `document.fonts.check()`
  reports `true` for fonts that were never loaded — verified empirically),
  logo bounding-box presence, and overflow.
- **Review & repair (Phase 4)**: real CIEDE2000 colour distance (via
  `culori`) between a sampled rendered region (interior pixels only, edges
  excluded to dodge antialiasing) and the approved hex; typography/logo
  checks that say `not_verified` rather than guessing `pass` when evidence is
  missing; a bounded (2-attempt) repair loop that corrects a wrong palette
  hex and re-renders — proven with a fixture that generates two real PNGs,
  shows a real ΔE-based failure, a real repair, and a real pass, plus a
  separate case that stays `unresolved` rather than ever producing a false
  pass.
- **Auth**: a single shared `APP_ACCESS_CODE` gates the whole app (this is a
  private prototype, not multi-tenant signup); signed, HttpOnly session
  cookies; CSRF via double-submit cookie; failed-login rate limiting.
- **Jobs**: a persistent SQLite queue with a bounded-concurrency worker
  (`MAX_CONCURRENT_JOBS`, default 2 — matches "two active workers globally").
  Each phase enqueues the next on success (`import` has no next step defined
  yet beyond readiness; `brief` → `generate`, which does review+repair
  inline — see "Known limitations").
- **Rate limits**: 5 imports/hour and 3 runs/hour per owner+IP,
  `DAILY_RUN_LIMIT` (default 20) runs per rolling 24h globally, and one
  active run per owner at a time.
- **Static serving**: the app's own frontend is served through a small
  from-scratch static file handler with correct MIME types, GET/HEAD, path-
  traversal protection, and a plain 404 for anything missing.
- **Sharing & the result page (Phase 5)**: `GET /b/:id` is a server-rendered
  page (the original task prompt, the approved brand, the briefs, every
  output with its preview/download, and its full review findings table),
  private by default — it checks the owner's session or a valid share token
  and 404s identically for "wrong token" and "brand doesn't exist" (existence
  is never confirmed to someone without access). `POST /api/brands/:id/share`
  creates a high-entropy (256-bit) capability token; only its SHA-256 hash is
  ever stored, so the raw token is shown exactly once, the same way an API
  key would be. `DELETE /api/brands/:id/share/:shareId` revokes it
  immediately. Asset and output downloads (`/api/assets/:id`,
  `/api/outputs/:id/file`) accept the same token for anonymous viewers.
  `X-Robots-Tag: noindex, nofollow` is set on the page. Mobile-responsive,
  keyboard-operable (native `<details>`/`<summary>` disclosures, no custom
  JS dialogs to manage focus for), alt text on the logo image,
  `prefers-reduced-motion` respected (the page uses essentially no motion),
  British English and sentence case throughout.
- **`MAX_RUN_TOKENS`** is now passed to the Anthropic call as `max_tokens`,
  making it a real cap rather than a parsed-but-unused value.

## What's NOT built yet

- **Deletion** exists for brands (`DELETE /api/brands/:id`, which also
  cascades to its shares); there's no retention-cleanup job yet
  (`RETENTION_DAYS` is parsed, not enforced).
- **Docker** — this dev machine has no local Docker to build/test an image
  against, so none was written speculatively.
- **Share expiry** — `shares.expires_at` exists in the schema and
  `isValidShareToken` already honours it, but nothing in the API sets an
  expiry yet; a share is revocable but doesn't currently expire on its own.
- **The wider security test suite** the full spec calls for (redirect/
  subresource SSRF, ownership/IDOR, and share access control are all covered;
  broader fuzzing, a CI pipeline with mocked paid APIs, etc. is not).
- **Rate limiting still doesn't coordinate across multiple instances** (see
  "Known limitations" — unchanged by Phase 5, since share creation/revocation
  are owner actions, not currently rate-limited at all beyond requiring a
  valid session and CSRF token).

## Known limitations (disclosed, not hidden)

- **Render + review share one job phase.** The `jobs` table's schema already
  allows a separate `"review"` phase, but `RenderEvidence` (pixel regions,
  font-check evidence, logo bounding box) has no column to persist it in
  the Phase 1 schema — serialising it would mean a new migration. Rather than
  invent that storage mid-integration, `run-generate-job.ts` renders *and*
  reviews each output in one job, immediately. A follow-up could split them
  once `RenderEvidence` has somewhere real to live between jobs.
- **`outputs.file_id` stores an absolute local path directly**, not a foreign
  key into a dedicated files table (none exists in the Phase 1 schema).
  Access is still ownership-checked through `GET /api/outputs/:id/file`,
  never served as a static path — but this is a simplification worth
  revisiting if outputs need to move between machines/storage backends.
- **The copy review check is a stub.** A real AI voice/fact assessment
  against the brief's sourced copy (Phase 2+ work) isn't wired in — it
  reports `not_verified` with one real mechanical sub-check (the seeded
  "no exclamation points" voice rule). `reviewOutput`'s `requireCopyVerified`
  option defaults to `false` so this doesn't block every run's
  `overallPass`; flip it once a real assessment exists.
- **No approved "image assets" concept yet.** The approval flow only
  supports one logo + a colour list + a font list (see `PATCH
  /api/brands/:id`). Phase 2's brief generator enforces this honestly: a
  brief with any `imageAssetIds` is rejected outright, rather than trusting
  an unapproved reference.
- **`paletteTokenHexes`/`fontFamilies` have a positional convention**
  ([background, primary, text, accent] / [heading, body]) that Phase 2's
  prompt now tells the model about, and Phase 3's renderer assumes. It's
  documented in both files' comments, not enforced by the type system.
- **Re-rendering during repair launches a fresh Chromium process per
  attempt** (correct per the "fresh isolated context" requirement, slower
  than reusing one browser — a deliberate trade-off, not an oversight).
- **Single shared owner.** `APP_ACCESS_CODE` is one code for one operator;
  every login resolves to the same `owner_default` row. The schema models
  `owner_id` everywhere so real multi-user support is additive, not a rewrite.
- **Rate limiting is in-process memory.** Resets on restart; does not
  coordinate across multiple instances.
- **CSS extraction doesn't resolve `var()`.** A declaration driven entirely
  by a custom property is left unextracted rather than guessed at.
- **`robots.txt` parsing is minimal** — exact-prefix `Disallow`/`Allow` only.
- **SVG sanitisation is conservative, not exhaustive** — adequate for a
  private prototype, not a substitute for a maintained sanitiser at wider
  exposure.
- **Named CSS colours aren't counted** (e.g. `tomato`) — only hex and
  `rgb()`/`rgba()`.
- **Approved custom webfonts aren't actually loaded into the renderer.**
  `buildTemplate` writes the approved font-family name into the CSS, but no
  `@font-face` file is fetched or embedded for it, and the renderer blocks
  all network requests (by design — see Phase 3's `installNetworkGuard`).
  For a brand like Goodspeed whose real fonts (Acid Grotesk, Lexend Deca)
  are proprietary webfonts, this means typography review will honestly
  **fail** every real run, falling back to Georgia/Arial, until the
  approved font files are downloaded/embedded the same way the logo asset
  already is.
- **Two real bugs caught only by a live run with a real `ANTHROPIC_API_KEY`,
  not by `npm test`** (see "Verified end to end" above for detail): forced
  `tool_choice` is a 400 on Claude Sonnet 5.5 (fixed via `messages.parse` +
  `output_config.format`), and the colour/typography review could report a
  tautological "pass" against the renderer's own internal fallback palette
  when nothing was actually approved (fixed with an
  `expectedHexApproved`/`expectedFamilyApproved` flag that forces
  `not_applicable` instead).
- **A real bug caught by manual browser testing, not `npm test`**:
  `share-page.ts` initially built the logo `<img src>` as
  `/api/assets/:id/file`, copying the outputs route's `/file` suffix onto the
  assets route, which doesn't have one (`GET /api/assets/:id`). Automated
  tests had covered token-gated access to both routes directly, but nothing
  rendered the actual page HTML and then fetched the URL it produced — so a
  broken image on the real page went unnoticed until a live check in a
  browser. Fixed, and a regression test (`tests/share-page-api.test.ts`,
  "the rendered /b/:id page's logo <img src> actually resolves") now fetches
  the real `<img src>` the page renders, not just the route in isolation.

## Environment variables

See `.env.example` for the full list with descriptions. All of `PORT`,
`NODE_ENV`, `APP_BASE_URL`, `DATABASE_PATH`, `ASSET_DIR`, `APP_ACCESS_CODE`,
`SESSION_SECRET`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`,
`MAX_CONCURRENT_JOBS`, `DAILY_RUN_LIMIT`, `MAX_RUN_TOKENS`,
`COLOUR_DELTA_E_THRESHOLD`, and `RETENTION_DAYS` are read in `src/config.ts`.

## Project layout

```
src/
  config.ts, pipeline-types.ts   env parsing; shared Brief/RenderEvidence/
                                  ReviewResult contracts between phases 2-4
  db.ts, migrate.ts               SQLite connection + migration runner
  ids.ts, brands.ts, runs.ts, outputs.ts, shares.ts   DB repositories
  jobs.ts                         persistent job queue + bounded worker
  llm.ts                          Anthropic brief generation + reference validation
  share-page.ts                   server-rendered /b/:id HTML
  static-files.ts                 from-scratch static file serving
  security/        url.ts (SSRF), session.ts, auth-middleware.ts, cookies.ts, csrf.ts, rate-limit.ts, brand-access.ts (owner-or-share-token check)
  import/           fetch.ts, robots.ts, extract.ts, assets.ts, svg-sanitize.ts, run-import-job.ts
  generate/          templates.ts, render.ts  (Playwright rendering)
  review/            colour.ts (CIEDE2000), review.ts, repair.ts
  jobs/              run-brief-job.ts, run-generate-job.ts
  server.ts          Express app + routes
migrations/0001_init.sql   full schema
public/                     the app's own frontend: sign in, import/approve,
                             start a run, enable/revoke sharing (vanilla HTML/CSS/JS)
tests/                      98 node:test tests (see "Tests" above)
```
