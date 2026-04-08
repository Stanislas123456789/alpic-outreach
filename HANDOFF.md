# Alpic Outreach — Handoff Prompt for New Agent

## What was built

A cold email outreach platform at `/Users/stanislasmichel/Desktop/Alpic Projects/alpic-outreach/` with 3 packages:

### `packages/pipeline` (Node.js / TypeScript)
- Reads contacts from Google Sheets (TRAVEL tab, sheet ID: `1OviVTObkxp39uCj_kQmRe8M7aqloDvPLq162oH63nQI`)
- Validates emails, sends via Gmail API (OAuth2), CC dimitri@alpic.ai
- Tracks status back to sheet (sent/bounced/opened/replied)
- Cron: every 30min Mon–Fri 8am–7pm, batch of 5
- Auth flow: `npm run auth --workspace=packages/pipeline` → opens browser on `localhost:4567`, captures token automatically
- Token rotation handled: auto-saves new refresh token to `.env` when Google rotates it
- Key env vars in `packages/pipeline/.env`:
  - `GMAIL_CLIENT_ID=997883387845-lafhmi0dr5uqqf7ddg1cakkcn30dok2h.apps.googleusercontent.com`
  - `GMAIL_CLIENT_SECRET=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`
  - `SENDERS` — JSON array of `{ email, name, refreshToken, dailyLimit }`
  - Currently only `stanislas@alpic.ai` has a valid refresh token; rep2/rep3 are placeholders

### `packages/dashboard` (React / Vite, port 3001)
- Analytics dashboard: funnel, rep leaderboard, industry breakdown, pipeline table
- Auth gate: keyword login (`VITE_ACCESS_KEYWORD=alpic2024`) OR Google OAuth (restricted to `@alpic.ai`)
- Google OAuth client: `alpic-web` (`997883387845-lafhmi0dr5uqqf7ddg1cakkcn30dok2h`)
- Auth state in localStorage
- Reads sheet via Google Sheets API (read-only API key)

### `packages/tracking-server` (not yet deployed)
- Tracking pixel server for open tracking — needs to be deployed

---

## What needs to be built next (in order)

### 1. Sender onboarding + sending via UI (PRIORITY)

The goal: any `@alpic.ai` team member can:
1. Sign in to the dashboard with Google OAuth
2. Connect their Gmail account (OAuth flow embedded in the UI)
3. See their sender status + daily quota
4. Trigger a send batch from the dashboard (not just CLI)

**Architecture needed:**
- The pipeline currently runs as a CLI/daemon. To trigger sends from the UI, you need a small API layer between the dashboard and the pipeline logic.
- Suggested approach: add a `packages/api` Express server (or use the existing `tracking-server`) with endpoints:
  - `POST /api/senders/connect` — initiates Gmail OAuth for a new sender, saves token
  - `GET /api/senders` — lists connected senders + daily stats
  - `POST /api/pipeline/run` — triggers a batch send (calls `runPipeline()`)
  - `GET /api/pipeline/status` — returns current pipeline state
- The dashboard calls this API instead of running the pipeline directly
- Store sender tokens in a JSON file or simple DB (not just `.env`) so new senders can be added without redeploying

**Sender onboarding flow in dashboard:**
- After Google OAuth login, if `user.email` has no refresh token stored → show "Connect your Gmail to start sending" button
- Button triggers: `GET /api/senders/auth?email=xxx` → redirects to Google OAuth → callback saves token → redirect back to dashboard
- Dashboard shows connected status + "Send batch" button

### 2. Deploy pipeline API to free hosting (Railway or Render)

- Railway is recommended (free tier, supports Node.js, persistent processes)
- The pipeline + API server should run together
- Env vars go into Railway dashboard
- The dashboard's API calls point to the Railway URL

### 3. Deploy dashboard to Vercel

- `cd packages/dashboard && vercel --prod`
- Add env vars in Vercel: `VITE_SHEET_ID`, `VITE_GOOGLE_API_KEY`, `VITE_GOOGLE_CLIENT_ID`, `VITE_ACCESS_KEYWORD`
- Add the Vercel production URL to authorized JavaScript origins in Google Console (`alpic-web` client)

### 4. Deploy tracking pixel server

- `packages/tracking-server` serves a 1x1 pixel at `/track/:contactId`
- When loaded, it calls `incrementOpenCount` in sheets
- Deploy to Vercel (it's a simple Express app)
- Update `TRACKING_BASE_URL` env var to the Vercel URL
- The pipeline embeds `<img src="${TRACKING_BASE_URL}/track/${contact.id}">` in email HTML

---

## Key files to read first

- `packages/pipeline/src/index.ts` — main pipeline orchestrator
- `packages/pipeline/src/gmail.ts` — OAuth2 sender logic (token rotation handling)
- `packages/pipeline/src/auth.ts` — standalone auth script (localhost:4567 callback server)
- `packages/pipeline/src/template.ts` — email subject/body builder
- `packages/dashboard/src/App.tsx` — main dashboard (has source switcher + modal already added by user)
- `packages/dashboard/src/hooks/useAuth.ts` — auth hook (keyword + Google OAuth)
- `packages/dashboard/src/components/LoginPage.tsx` — login UI

## Google Cloud setup (already done)
- Project: `vertical-task-477616-a6` ("My First Project")
- OAuth client `alpic-web`: `997883387845-lafhmi0dr5uqqf7ddg1cakkcn30dok2h`
  - Authorized JS origins: `http://localhost:3001`
  - Authorized redirect URIs: `http://localhost:4567/`
- Gmail API: enabled
- Sheets API: enabled
- Service account for Sheets: `alpic-sheets@vertical-task-477616-a6.iam.gserviceaccount.com`

## Important gotchas
- The Google Cloud app is in **Testing mode** — refresh tokens may rotate. The token rotation handler in `gmail.ts` auto-saves to `.env`. When deploying, this needs to write to a persistent store instead.
- Only `@alpic.ai` Google accounts are allowed in the dashboard auth
- The pipeline uses `BATCH_SIZE=5` per run
- The `TEST_EMAIL` env var redirects all sends to a test address without updating the sheet
- `DRY_RUN=true` previews emails without sending
