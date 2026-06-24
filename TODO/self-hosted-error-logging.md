# Self-hosted, deploy-durable logging (deploys + errors)

**Goal:** persist two kinds of operational log somewhere that **survives a
Coolify redeploy** — (1) a record of each deploy, and (2) unexpected client-side
errors (and device-write failures) from real users — so we can confirm deploys
and diagnose the intermittent "writing to your device didn't work" class of
reports. Explicitly **not** a Sentry-style SaaS — no third-party service, no PII.
The same privacy posture as our Umami analytics: aggregate, anonymous,
self-hosted.

The hard constraint is persistence. The production server runs in a Coolify
container whose filesystem is **ephemeral** — every redeploy builds a fresh
image, so anything the server wrote inside the container is wiped. Logs must land
on a **Coolify Persistent Storage volume** (a Docker volume / bind mount that
lives outside the image), reached via an env-configured directory.

## Status

- **Deploy logging — DONE.** Logic in `scripts/deploy-log.mjs`, run by the CLI
  `scripts/log-deploy.mjs`, which is invoked from `nixpacks.toml`'s `[start]`
  command (`node scripts/log-deploy.mjs && npm start`) — the **start** phase, not
  build, because the volume isn't mounted during the Nixpacks build. Each
  container start appends one record to `<LOG_DIR>/deploys/<version>.log`; covered
  by `tests/unit/deploy-log.test.js`. The file server (`serve-dist.mjs`) stays a
  pure static server. The Coolify volume + `LOG_DIR=/app/logs` are already
  configured (see below). **This is the working precedent the error half should
  mirror** (best-effort, never throws, filename sanitised). Note it's a *boot*
  record: `[start]` runs on every container start, so a restart re-appends —
  distinguishing true redeploys from restarts would need a build-time identity
  baked into the image (future, out of scope for now).
- **Error logging — TODO.** Everything in Tasks/Tests below.

## Layout on the volume (`STORAGE_DIR`)

`STORAGE_DIR` is the persistent **data** root (one Coolify volume,
`/app/storage` in production, `./tmp/storage` locally):

```
<STORAGE_DIR>/
  logs/deploy-<version>.log   # deploy/boot records, one file per version  (DONE)
  errors.sqlite               # error reports, a single SQLite database     (TODO)
```

Each browser session generates a random, ephemeral **session UUID** client-side,
sent with every error report and stored as a column so a multi-step failure reads
as one story. That UUID is a throwaway correlation id, **not** PII and **not** the
Kobo hardware UUID/serial (those must never be logged).

## Where this lives today

- **One client chokepoint already catches everything.**
  `src/js/shell/error-screen.js` installs the global handlers
  (`window.addEventListener('error', …)` and `'unhandledrejection'`, ~lines
  123–129) which both funnel into `handleUnexpectedError(err)` (~lines 108–121).
  That handler already derives `err.stack || err.message || String(err)` and
  shows the error screen. **This is the single place to also report the error** —
  every uncaught error and rejection in the app passes through it.
- **Device-write failures are the highest-value errors and have their own path.**
  `writeToDevice` in `src/js/shell/terminal.js` records a `Failed:` audit line and
  routes to `state.showError(..., 'deviceWrite')` when a write throws. These are
  exactly the reports we can't currently reproduce, so they deserve an explicit
  report call in addition to whatever the global handler catches.
- **The server is a small static Node server with env-var config precedent.**
  `scripts/serve-dist.mjs` is GET-only static serving plus one non-static route
  (the live-reload SSE at `/__livereload`, ~line 226) — a ready model for adding a
  `POST /api/error` route *before* the static-file logic. It already reads
  optional env (`UMAMI_WEBSITE_ID`, `UMAMI_SCRIPT_URL`, `PORT`, `DIST_DIR`) at the
  top, so a `STORAGE_DIR` / `ERROR_WEBHOOK_URL` follows the same pattern (the
  deploy-log CLI already reads `STORAGE_DIR`). Per PROJECT.md "Production
  Serving", keep this server deliberately small.
- **Privacy stance is established.** `src/js/shell/analytics.js` (Umami wrapper)
  is opt-in via server-side injection and sends no personal identifiers; gate
  `window.__ANALYTICS_ENABLED`. Error logging should mirror this — no IP storage,
  no device serials/UUIDs, no file paths that include a username.
- **App version is available on both sides.** Client: `vite.config.mjs` injects
  `globalThis.__APP_VERSION__` (the literal version, e.g. `"1.37"`) at build time
  via `generateVersion()`, consumed in `installer.js` / `flows/patches-flow.js` /
  `flows/patches-execute.js` — so an error report can tag the build directly.
  Server: `deploy-log.mjs`'s `resolveDeployInfo()` reads the version from
  `package.json` plus the commit from `.version.json` (also produced by
  `generateVersion()` during the build). Both ultimately read `package.json`'s
  version; `generateVersion()` adds the commit + GitHub link on top.

## Design / decisions

- **Transport — DONE.** The client uses `navigator.sendBeacon('/api/error', blob)`
  first, then falls back to `fetch(..., { keepalive: true })` if beacon is missing
  or returns false. Reporting never throws or blocks the UI.
- **Storage: a single SQLite database at `${STORAGE_DIR}/errors.sqlite`** (DONE
  server-side — supersedes the earlier per-session `errors/<uuid>.log` file
  approach). One append-only `errors` table makes the reports queryable (group by
  `kind`, `app_version`, `session_id`; count over time) without a viewer UI, and
  one file beats one-file-per-session for backup/footprint. The implementation
  uses Node's built-in `node:sqlite` and applies ordered migrations on first
  write. The admin backend code lives under `scripts/admin/`; each migration
  lives in `scripts/admin/migrations/`; applied
  migrations are tracked in a `migrations` table with a Laravel-style `batch`
  number.
- **Schema (one row per report):** `errors(id INTEGER PK, ts TEXT, session_id
  TEXT, app_version TEXT, kind TEXT, message TEXT, stack TEXT, user_agent TEXT,
  flow_step TEXT)`. `kind` is e.g. `unexpected` (global handler) or `deviceWrite`
  (terminal failure). Normal report rows contain no IPs, no Kobo serials/UUIDs,
  no onboard file contents. Abusive IPs that cross the server rate limit are
  stored separately in `ip_blacklist(ip, banned_at, reason, request_count,
  window_seconds)`.
- **Session UUID, client-generated.** On first need in a session, mint a random
  UUID (`crypto.randomUUID()`), keep it in memory (optionally `sessionStorage` so
  a reload reuses it), and send it with every report → the `session_id` column.
  Random, ephemeral, non-identifying.
- **Server route: `POST /api/error`** lives in `scripts/admin/routes/` and is
  mounted by both `serve-dist.mjs` and the Vite dev server. Read the body with a
  small hard cap (e.g. 16 KB — reject larger), parse JSON defensively, and `INSERT`
  one row into `errors.sqlite` (parameterised — never string-build SQL). Respond
  `204` always (even on a bad body) so a malformed beacon can't surface as a client
  error. Rate-limit by client IP before reading the body (10 requests per 15
  minutes); only IPs that exceed the threshold are written to `ip_blacklist`. Keep
  it best-effort: a DB-open/insert failure is swallowed, mirroring the deploy logger.
- **Admin error log route — DONE.** `GET /admin` shows a paginated newest-first
  table of errors when `ADMIN_USERNAME` + `ADMIN_PASSWORD` are set and the visitor
  passes Basic Auth. `GET /admin/errors.sqlite` streams the raw SQLite file as a
  browser download. If either env var is missing, both endpoints are disabled
  (404).
- **Client reporting — DONE.** `src/js/shell/error-report.js` sends unexpected
  errors from `shell/error-screen.js` and device-write failures surfaced through
  the shared error screen. It mints/reuses a random per-session ID, includes app
  version + flow step + message/stack, de-duplicates identical reports, and caps
  each page load at 10 reports. Firmware build/patch failures are handled
  workflow errors and are not reported.
- **Persistence: `STORAGE_DIR` env → a Coolify Persistent Storage volume.** Already
  in place and consumed by deploy logging; the error route reuses the same
  `STORAGE_DIR`, just the DB file at its root. In production Coolify sets
  `STORAGE_DIR=/app/storage`; locally fall back to `./tmp/storage` (gitignored) the
  same way `log-deploy.mjs` does — consider factoring that `process.env.STORAGE_DIR
  || ./tmp/storage` resolution into a shared helper the error route reuses.
- **Growth/retention.** A single DB file, so no file-count problem; watch row
  count instead. Optionally prune rows older than N days on startup (a single
  `DELETE FROM errors WHERE ts < ?`). `VACUUM` only if the file actually bloats.
- **Optional live alerting: `ERROR_WEBHOOK_URL`.** If set, the server also POSTs a
  compact summary to a Discord/Telegram/ntfy webhook for a push notification.
  Best-effort — a webhook failure must never break the `/api/error` response or
  the DB insert.
- **Client-side rate-limit + dedupe — required, see open question.** A looping
  error (e.g. a render error that re-throws every frame) must not flood the DB. At
  minimum: collapse identical `message+stack` within a session and cap reports per
  page load.

## Deploying on Coolify (persistent storage)

The app deploys via **Nixpacks** (`nixpacks.toml`, `npm start` → the Node static
server), not Docker Compose, so Coolify cannot infer a volume from the repo. The
volume is added **once in the Coolify UI** and then persists across every
redeploy automatically (a redeploy replaces the container/image, never the
volume). This is a one-time operator step, not a per-deploy one.

Canonical steps live in PROJECT.md "Deploy Logging"; in short:

1. Resource → **Storages** → **+ Add** → **Volume Mount** (a Coolify-managed
   named Docker volume — survives redeploys and container recreation, no host
   bind-mount permission issues).
   - **Name:** any label (e.g. `app-storage`)
   - **Source Path:** *leave empty* — empty is what makes it a managed named
     volume; a value here would turn it into a host bind mount instead.
   - **Destination Path:** `/app/storage` (path inside the container)
2. Resource → **Environment Variables** → add `STORAGE_DIR=/app/storage` (must
   match the Destination Path exactly).

Notes:

- Destination can be any absolute path as long as `STORAGE_DIR` matches it;
  `/app/storage` sits cleanly alongside the served `/app/dist`.
- One volume holds all persisted state (deploy logs under `logs/`, the planned
  `errors.sqlite` at the root).
- The named volume is deleted only if you delete it or the whole resource — back
  it up before tearing the resource down.
- A **Docker Compose** deployment is the only way to make the volume declarative /
  version-controlled (a `volumes:` block Coolify creates on deploy). That's a
  bigger change than this feature needs; revisit alongside the
  `nixpacks.toml` "replace simple node server" TODO if serving is reworked.

> **Migration note:** the env var was renamed `LOG_DIR` → `STORAGE_DIR` and the
> mount path `/app/logs` → `/app/storage`. Update both in Coolify before the next
> deploy, or deploy logging silently falls back to the in-container `./tmp/storage`
> (ephemeral, lost on redeploy).

## Tasks

Deploy logging is done (see Status). Remaining work is the error half:

- [x] ~~Deploy logging: `scripts/deploy-log.mjs` logic + `scripts/log-deploy.mjs`
      CLI, invoked from `nixpacks.toml` `[start]`, writing `logs/deploy-<version>.log`.~~
- [x] ~~`STORAGE_DIR` handling in the CLI (deploy logs under its `logs/` subdir);
      locally defaults to `./tmp/storage` (already gitignored), production
      overrides via the env var.~~
- [x] ~~`npm run version:generate` added to the Nixpacks build phase so the
      commit is recorded in deploy logs.~~
- [x] ~~Session-UUID helper (client): mint `crypto.randomUUID()` once per session
      (in-memory, optionally `sessionStorage`), exposed to the reporter.
- [x] ~~Client reporter module (e.g. `src/js/shell/error-report.js`): a single
      `reportError({ kind, error, flowStep })` that builds the payload (incl.
      `sessionId`, `navigator.userAgent`, `appVersion` from the build-injected
      `globalThis.__APP_VERSION__`) and `sendBeacon`s it. Must never throw; the
      server/operator can disable storage with `ERROR_LOGGING=off`.~~
- [x] ~~Call it from `handleUnexpectedError` in `shell/error-screen.js` (kind
      `unexpected`) — the global catch-all.~~
- [x] ~~Call it from the device-write failure path in `shell/terminal.js`
      (`writeToDevice`, kind `deviceWrite`) with the flow/step context.~~
- [x] ~~Add the in-session dedupe + per-load cap to the reporter.~~
- [x] ~~SQLite helper + `POST /api/error` route in `scripts/serve-dist.mjs`: open
      `${STORAGE_DIR}/errors.sqlite` (apply schema migrations), body size cap,
      defensive JSON parse, parameterised `INSERT` of one row, always `204`, never
      store IPs in normal error rows, best-effort (swallow DB errors). Keep it
      above the static-serve branch like the SSE route.~~
- [x] ~~Rate-limit `POST /api/error` to 10 requests per 15 minutes by client IP
      and store abusive IPs in the separate `ip_blacklist` table so normal error
      rows stay IP-free.~~
- [x] ~~Admin error log route: `GET /admin` protected by browser Basic Auth from
      `ADMIN_USERNAME` / `ADMIN_PASSWORD`, showing a paginated error table, plus
      `GET /admin/errors.sqlite` for raw DB download.~~
- [ ] Optional `ERROR_WEBHOOK_URL` mirror (best-effort, non-blocking).
- [x] ~~Docs: PROJECT.md "Deploy Logging" — Coolify persistent volume mount +
      `STORAGE_DIR` + the deploy half are documented.~~ Remaining: extend it with
      the `errors.sqlite` schema, the `ERROR_WEBHOOK_URL` env, and the no-PII
      contract once error logging lands.

## Tests

- [x] ~~Unit (deploy logging): `tests/unit/deploy-log.test.js` covers append vs
      overwrite, disabled no-op, commit shortening, filename sanitisation
      (traversal-safe), write-failure resilience, and `resolveDeployInfo`
      fallbacks.~~
- [x] ~~Unit (client reporter): given a fake `navigator.sendBeacon`, asserts the
      payload shape (sessionId, kind, message, stack, userAgent), that it never
      throws when `sendBeacon` is missing/returns false, and that the in-session
      dedupe/cap suppresses repeats.~~
- [x] ~~Unit (server route): drive the shared `POST /api/error` handler with a valid
      body → one row in `errors.sqlite` with the expected columns; an
      oversized/garbage body → no throw, still `204`, no row written; assert no IP
      is recorded.~~
- [x] ~~Unit (admin route): no env vars disables the endpoint, missing/wrong Basic
      Auth challenges, a missing DB gets an empty page, valid credentials download
      `errors.sqlite` as an attachment, and `/admin` paginates/escapes the
      newest-first table.~~
- [ ] E2E (optional): force an unexpected error in the app and assert a beacon to
      `/api/error` is issued (point the test server's `STORAGE_DIR` at a temp dir
      and assert a row landed in the DB).

## Out of scope

- **Sentry / any third-party error SaaS** — explicitly excluded.
- **Source-map symbolication / release tracking** — stacks are logged raw; tie to
  a build via `appVersion`. Revisit only if minified stacks prove unreadable.
- **Full dashboard UI** — `/admin` intentionally stays a tiny server-rendered table;
  richer filtering/search/charting is a separate future task.
- **Reporting *handled* errors** (expected validation failures, user-cancelled
  pickers, `AbortError`, firmware build/patch failures) — only
  unexpected/global errors and device-write failures. `handleUnexpectedError`
  already ignores `AbortError`; keep that.

## Open questions to resolve before implementing

- **Consent/operator gating.** Current implementation sends reports from the
  client whenever an unexpected/device-write failure occurs; the operator can
  disable storage with `ERROR_LOGGING=off`, and the endpoint still returns 204.
- **Retention.** Decide whether/when to prune old rows (e.g. `DELETE` rows older
  than N days on startup).
