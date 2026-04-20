# Alpic Outreach — Improvement Backlog

A prioritized list of code-base improvements. Findings are grouped by priority and reference concrete file paths.

Legend:
- **P0** — security / data loss / production incident. Do immediately.
- **P1** — correctness bugs or high-impact gaps. Do this week.
- **P2** — quality, tests, architecture. Do this month.
- **P3** — nice-to-have polish and DX.

---

## P0 — Security (do now)

- [ ] **Rotate `GMAIL_CLIENT_SECRET`**. A real value is committed at `packages/api/.env.example:8` (`GOCSPX-…`). Rotate in Google Cloud Console, then replace the file's value with a placeholder like `GOCSPX-your-secret-here`.
- [ ] **Rotate `VITE_GOOGLE_API_KEY`**. Committed at `packages/dashboard/.env.production.local:25`. Regenerate in Google Cloud and restrict the new key to Sheets API + specific referrers.
- [ ] **Remove `packages/dashboard/.env.production.local` from git**. It is tracked (`git ls-files` confirms). Delete it, add `*.env.production.local` and `.env*` (except `.env.example`) to `.gitignore`, and purge from history with `git filter-repo`. The Vercel OIDC token in the file is already past its `exp`, but the Google API key is live.
- [ ] **Tighten `.gitignore`**. The current 87-byte `.gitignore` is missing patterns for `.env`, `.env.*`, `data/*.json` (sender tokens), and `packages/api/data/senders.json`.
- [ ] **Audit `packages/api/data/` for committed tokens**. If `senders.json` was ever committed, treat all sender refresh tokens as compromised and re-run OAuth for every sender.

## P1 — Correctness & reliability

- [ ] **Add a persistent sender-token store**. HANDOFF.md flags this: tokens currently live in `.env`/`senders.json` on the API host. Move to a managed DB (Railway Postgres, Supabase, or a Railway-volume-backed SQLite) so token rotation survives redeploys and doesn't race with `.env` parsing.
- [ ] **Fix fire-and-forget campaign execution**. `packages/api/src/routes/pipeline.ts` `POST /run` responds before the campaign finishes; errors only reach logs. Persist a `campaign_runs` record with state (`running|success|failed`, `error`, `counts`) so the UI can poll `/api/pipeline/status` and surface failures.
- [ ] **Await status writes before moving to next contact** in `packages/pipeline/src/index.ts`. If `updateContactStatus` fails, the next send proceeds against stale sheet state — risk of double-sending.
- [ ] **Validate `POST /api/senders/seed` input** (`packages/api/src/routes/senders.ts`). Accepts arbitrary JSON and overwrites the sender store. Add a zod schema + require an internal auth token, and reject if any sender lacks `email`/`refreshToken`.
- [ ] **Sanitize email preview rendering**. `packages/dashboard/src/components/CampaignWizard.tsx` and `SendPreviewModal.tsx` both use `dangerouslySetInnerHTML` on built email bodies. Contact fields (`firstName`, `company`, `competitors`) flow into the HTML unescaped — a malicious row in the sheet could execute JS in the reviewer's browser. Either escape all interpolated contact fields in `template.ts`, or run the built HTML through DOMPurify before preview.
- [ ] **Escape contact fields inside `buildSubject`/`buildBody`** in `packages/pipeline/src/template.ts`. A contact with `firstName = "</p><script>…"` would inject into the outgoing email too. Add a small `escapeHtml()` helper and apply to every interpolation.
- [ ] **Handle Google token rotation concurrency** in `packages/pipeline/src/gmail.ts`. The `.env` write-back is not atomic; two refreshes running in parallel can clobber one another. Either serialize rotations with a mutex or (preferred) route rotations through the API's `setTokenRotationCallback` and drop the `.env` fallback entirely.
- [ ] **Add a `/health` endpoint** to `packages/api/src/index.ts` so Railway can do proper health checks (`{ ok: true, uptime, version }`).

## P2 — Architecture, testing, DX

- [ ] **Add a test suite**. Zero tests exist. Start with:
  - `packages/pipeline`: `template.test.ts` (subject/body rendering, escaping), `gmail.test.ts` (mocked Gmail client, token rotation).
  - `packages/api`: supertest coverage of `/api/senders/*` and `/api/pipeline/*`.
  - `packages/dashboard`: React Testing Library for `CampaignWizard` state transitions.
- [ ] **Add `typecheck` + `lint` scripts** to every workspace and a root `npm run check` that fans out. No TS noEmit is currently wired up.
- [ ] **Add a CI workflow** (`.github/workflows/ci.yml`) that runs typecheck, lint, and tests on PR.
- [ ] **Break up `packages/dashboard/src/App.tsx` (1 059 lines)**. Extract analytics widgets (`Funnel`, `RepLeaderboard`, `IndustryBreakdown`, `PipelineTable`) into dedicated files. Aim for < 200 lines in `App.tsx`.
- [ ] **Break up `CampaignWizard.tsx` (1 211 lines)** into step components (`TemplateStep`, `RecipientsStep`, `PreviewStep`, `ReviewStep`) with a small reducer for wizard state.
- [ ] **Split `packages/api/src/routes/pipeline.ts` (559 lines)** by concern: `preview.ts`, `run.ts`, `campaigns.ts`.
- [ ] **Type-safe sheet columns**. `packages/pipeline/src/sheets.ts` sprinkles column letters (`W`, `X`, …) through the code. Replace with a single `SHEET_COLUMNS` enum/const map + typed row accessor.
- [ ] **Extract shared utilities** into a new `packages/shared/` workspace: PEM key parsing (duplicated in `sheets.ts`, `gmail.ts`, `tracking-server/api/pixel/[id].js`), contact types, column map, HTML escape helper.
- [ ] **Pagination on contact endpoints**. `GET /api/pipeline/preview` returns an unbounded list; `App.tsx` renders them all. Add `limit`/`offset`, default 100, paginate the table UI.
- [ ] **Cache Sheets reads** in the dashboard with a stale-while-revalidate hook (5 min TTL). Right now each mount re-hits Sheets.
- [ ] **Batch Sheets reads in `tracker.ts`**. Use `spreadsheets.values.batchGet` instead of one call per thread.

## P3 — Polish & ops

- [ ] **Kill `--openssl-legacy-provider` in `Dockerfile:4`**. Upgrade `google-auth-library` / Node to 20+ and drop the flag; it masks RSA key bugs rather than fixing them.
- [ ] **Deploy `packages/tracking-server`** (still listed as not deployed in HANDOFF.md) and point `TRACKING_BASE_URL` at the live domain. Verify open-tracking writes back to the sheet end-to-end.
- [ ] **Make the `@alpic.ai` domain allow-list configurable** via `ALLOWED_EMAIL_DOMAINS` env var in `packages/api/src/routes/senders.ts:25` — currently hard-coded.
- [ ] **Add structured logging** (pino) to the API + pipeline, with a `requestId` per campaign run, so Railway logs are searchable.
- [ ] **Add basic request rate limiting** (express-rate-limit) on `/api/senders/auth` and `/api/pipeline/run` to reduce abuse surface.
- [ ] **Update `README.md`** with the current layout (four workspaces, API server exists, Vercel + Railway deployment steps). The doc currently lags `HANDOFF.md`.
- [ ] **Add JSDoc to public route handlers** in `packages/api/src/routes/*.ts` so OpenAPI/Swagger generation is trivial later.
- [ ] **Extract magic numbers**: `BATCH_SIZE`, `MIN_DELAY_SECONDS`, `MAX_DELAY_SECONDS`, working-hours window, CC address — collect them into a single `config.ts` in the pipeline.
- [ ] **Bundle-size audit** of the dashboard (`vite build --report`). Lazy-load `CampaignWizard`, `SendPreviewModal`, and the Recharts imports to shrink the initial chunk.
- [ ] **Consistent error shape** across the API (`{ error: { code, message } }`) — currently mixes `res.status(400).send('string')` and `res.json({ error })`.

---

## Quick wins (< 30 min each)

- Remove `.env.production.local` + tighten `.gitignore`.
- Add `/health` endpoint.
- HTML-escape interpolations in `template.ts`.
- Add `typecheck` scripts to every package.
- Add CI workflow running typecheck.

## Larger initiatives (multi-day)

- Persistent token store + migration from `.env`/JSON.
- Campaign-run persistence + status polling.
- Refactor the two 1 000-line React components.
- Full test suite + CI gate.
