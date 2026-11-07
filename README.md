# Goodspeed Brand OS

Imports a real website's brand, drafts task briefs against it, renders real
downloadable assets, reviews them against the brand (with a bounded
auto-repair loop), and (eventually) publishes a shareable result page.

**Status: Phases 1–4 built and tested; Phase 5 (sharing, Docker, deeper rate
limiting) is not.** The whole pipeline — import a real site → approve its
brand → draft briefs → render real PNG/PDF assets → review with real
CIEDE2000 colour checks and repair on failure — runs end to end. What's
missing is documented plainly below, not glossed over. **Nothing in this repo
has been deployed.**

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

82 tests, entirely offline, running under `node --env-file=.env.test`:
SSRF checks spin up real local HTTP servers to prove loopback/metadata
addresses are refused; Phase 3's tests launch a real headless Chromium and
assert on real PNG/PDF bytes; Phase 4's deterministic wrong-palette-token
fixture computes a real CIEDE2000 ΔE. The one thing not exercised by `npm
test` is a real Anthropic API call (no key in this environment) and a real
network import (exercised manually — see below).

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
```

### Verified end to end (manually, not part of `npm test`)

With the server running locally and no `ANTHROPIC_API_KEY` set: imported
`https://goodspeed.studio` (status `ready`, zero unknowns, its real palette
and font stack extracted, real logo/og-image/favicon downloaded and
sanitised), approved a logo + 2 colours + 1 font, created a run, and watched
it fail cleanly at the brief step with
`"ANTHROPIC_API_KEY is not configured — set it in .env to generate real
briefs."` — the run's status became `failed` and the job recorded that exact
error. No pretend briefs, no fake output. Once a real key is added, the same
run would proceed through brief → generate → review automatically (the job
chain is real; `tests/run-brief-job.test.ts`,
`tests/generate.test.ts`, and `tests/review.test.ts`/`repair.test.ts` each
test their own stage with real Playwright/CIEDE2000 but a mocked Anthropic
client, since no key exists in this environment).

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

## What's NOT built yet (Phase 5)

- **The shareable result page** (`/b/:id`), capability-token sharing and
  revocation.
- **Deletion** exists for brands (`DELETE /api/brands/:id`); there's no
  retention-cleanup job yet (`RETENTION_DAYS` is parsed, not enforced).
- **`MAX_RUN_TOKENS`** is parsed and validated but not yet passed to the
  Anthropic call as a hard cap (the brief call uses a fixed `max_tokens:
  4096`).
- **Docker** — this dev machine has no local Docker to build/test an image
  against, so none was written speculatively.
- **The wider security test suite** the full spec calls for (redirect/
  subresource SSRF is covered; broader fuzzing, a CI pipeline with mocked
  paid APIs, etc. is not).

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
  ids.ts, brands.ts, runs.ts, outputs.ts   DB repositories
  jobs.ts                         persistent job queue + bounded worker
  llm.ts                          Anthropic brief generation + reference validation
  static-files.ts                 from-scratch static file serving
  security/        url.ts (SSRF), session.ts, auth-middleware.ts, cookies.ts, csrf.ts, rate-limit.ts
  import/           fetch.ts, robots.ts, extract.ts, assets.ts, svg-sanitize.ts, run-import-job.ts
  generate/          templates.ts, render.ts  (Playwright rendering)
  review/            colour.ts (CIEDE2000), review.ts, repair.ts
  jobs/              run-brief-job.ts, run-generate-job.ts
  server.ts          Express app + routes
migrations/0001_init.sql   full schema
public/                     the app's own frontend (vanilla HTML/CSS/JS, Phase 1 import/approve UI only — no run/review UI yet)
tests/                      82 node:test tests (see "Tests" above)
```
