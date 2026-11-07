# Goodspeed Brand OS

Imports a real website's brand, drafts task briefs against it, renders real
downloadable assets, reviews them against the brand, and (eventually)
publishes a shareable result page.

**Status: Phase 1 only.** Brand import, extraction, and the approval UI work
end to end against real sites. Brief generation (Anthropic), asset rendering
(Playwright), review/repair, and sharing are not built yet — see "What's not
built yet" below. Nothing in this repo has been deployed.

## Setup

```bash
npm install
cp .env.example .env     # fill in APP_ACCESS_CODE and SESSION_SECRET at minimum
npm run migrate
npm run build
npm start                 # or: npm run dev
```

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Open `http://localhost:3000`, sign in with `APP_ACCESS_CODE`, and paste a
public site URL to import its brand.

## Tests

```bash
npm test
```

Runs under `node --env-file=.env.test`, entirely offline: SSRF checks spin up
real local HTTP servers to prove loopback/metadata addresses are refused, and
the one live-network test in this phase is exercised manually (see below),
not part of `npm test`.

## What's implemented (Phase 1)

- **Import**: fetch exactly one HTML page plus up to 10 linked stylesheets
  (25 MB / 30 s budget total), under full SSRF protection — hostname and every
  redirect target are freshly resolved and checked against disallowed IP
  ranges, and the connection is made to the validated IP literal (never the
  hostname again) to close the DNS-rebinding window. `robots.txt` is checked
  before fetching.
- **Extraction**: logo candidates (favicon, og:image, header `<img>`/`<svg>`,
  deduplicated), colour declarations (hex/rgb, counted by how many
  declarations used them — not a visual-prominence claim), CSS custom
  properties, `font-family`/`@font-face`/Google Fonts links, and a bounded
  readable-copy excerpt. Every gap is recorded as an explicit "unknown" rather
  than guessed.
- **Assets**: up to 5 logo-ish candidates are downloaded, MIME/size-validated,
  SVGs sanitised (scripts, event handlers, and external references stripped),
  and stored outside the public web root, served only through an
  ownership-checked route.
- **Auth**: a single shared `APP_ACCESS_CODE` gates the whole app (this is a
  private prototype, not multi-tenant signup); signed, HttpOnly session
  cookies; CSRF via double-submit cookie; failed-login rate limiting.
- **Jobs**: a persistent SQLite queue with a bounded-concurrency worker
  (`MAX_CONCURRENT_JOBS`, default 2 — matches "two active workers globally").
- **Static serving**: the app's own frontend is served through a small
  from-scratch static file handler with correct MIME types, GET/HEAD, path-
  traversal protection, and a plain 404 for anything missing — never the app
  shell in place of a missing asset.

Verified against a real site during development (not part of the automated
suite, since it needs network access): importing `https://goodspeed.studio`
correctly extracted its real palette (`#242f28`, `#36493c`, `#c6dd66`,
`#f9f2ed`), its real font stack (Geist, Inter, Acid Grotesk, etc. — the
page's actual `@font-face` rules), and downloaded + sanitised its real header
logo SVG, og:image, and favicon with zero unknowns.

## What's NOT built yet

- **Briefs** (Phase 2): `POST /api/brands/:id/runs`, Anthropic-backed brief
  generation, Zod-validated structured output, reference validation against
  the approved brand context.
- **Rendering** (Phase 3): Playwright-based HTML→PNG/PDF rendering for the
  LinkedIn image, one-pager PDF, slide, and post copy.
- **Review & repair** (Phase 4): CIEDE2000 colour comparison, typography/logo
  presence checks, AI copy assessment, the bounded auto-repair loop, and the
  deterministic wrong-palette-token test fixture.
- **Sharing & the result page** (Phase 5): `/b/:id`, capability-token
  sharing/revocation, deletion with confirmation (delete exists; sharing does
  not), per-owner/IP run rate limits (import limits exist; run limits don't,
  since there are no runs yet), Docker, and the security test suite beyond
  what Phase 1 already covers (SSRF, static serving, auth, ownership/IDOR).

## Known limitations (disclosed, not hidden)

- **Single shared owner.** `APP_ACCESS_CODE` is one code for one operator;
  every login resolves to the same `owner_default` row. The schema models
  `owner_id` everywhere so real multi-user support is additive, not a rewrite.
- **Rate limiting is in-process memory.** Resets on restart; does not
  coordinate across multiple instances. Fine for one Railway instance, not
  for a scaled-out deployment.
- **CSS extraction doesn't resolve `var()`.** A `font-family` or colour
  declaration driven entirely by a custom property (e.g.
  `var(--brand-font, "Inter", sans-serif)`) is left unextracted rather than
  guessed at — see the test "does not shred a font-family var() fallback
  chain" for the bug this replaced.
- **`robots.txt` parsing is minimal.** Exact-prefix `Disallow`/`Allow` only;
  no wildcard/`$` matching, crawl-delay, or sitemap parsing.
- **SVG sanitisation is conservative, not exhaustive.** Strips `<script>`,
  event handler attributes, and non-local `href`/`xlink:href` references.
  Adequate for a private prototype; a maintained sanitiser (e.g. DOMPurify)
  would be warranted before wider exposure.
- **Named CSS colours aren't counted** (e.g. `tomato`) — only hex and
  `rgb()`/`rgba()`. `hsl()`/`hsla()` are detected but not colour-converted yet.
- **No Docker image yet** — this dev machine has no local Docker to build/test
  one against, so it wasn't written speculatively.

## Environment variables

See `.env.example` for the full list with descriptions. All of `PORT`,
`NODE_ENV`, `APP_BASE_URL`, `DATABASE_PATH`, `ASSET_DIR`, `APP_ACCESS_CODE`,
`SESSION_SECRET`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`,
`MAX_CONCURRENT_JOBS`, `DAILY_RUN_LIMIT`, `MAX_RUN_TOKENS`,
`COLOUR_DELTA_E_THRESHOLD`, and `RETENTION_DAYS` are read in `src/config.ts`.
`DAILY_RUN_LIMIT`, `MAX_RUN_TOKENS`, `COLOUR_DELTA_E_THRESHOLD`, and
`RETENTION_DAYS` are parsed and validated now but not yet enforced anywhere
(no runs or review exist yet to enforce them against).

## Project layout

```
src/
  config.ts              env parsing/validation
  db.ts, migrate.ts       SQLite connection + migration runner
  ids.ts                  random ID generation
  brands.ts               brand/source_asset DB repository
  jobs.ts                 persistent job queue + bounded worker
  static-files.ts         from-scratch static file serving (MIME/404/HEAD)
  security/
    url.ts                SSRF-resistant fetch
    session.ts            signed sessions, access-code check
    auth-middleware.ts     login/logout/session Express middleware
    cookies.ts, csrf.ts, rate-limit.ts
  import/
    fetch.ts              bounded page+stylesheet fetch orchestration
    robots.ts              minimal robots.txt check
    extract.ts             HTML/CSS → brand context, with provenance
    assets.ts, svg-sanitize.ts
    run-import-job.ts      the "import" job phase handler
  server.ts                Express app + routes
migrations/0001_init.sql   full schema (Phase 1 uses a subset of its tables)
public/                    the app's own frontend (vanilla HTML/CSS/JS)
tests/                     node:test suite (34 tests, all offline except
                           the manual goodspeed.studio check described above)
```
