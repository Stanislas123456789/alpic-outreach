# Alpic Outreach — Resilience & Roadmap Backlog

Mission: make the platform the kind of stack that **never makes you log out and redo OAuth to launch a campaign**, that degrades gracefully instead of failing, and that grows into a proper outreach tool with follow-ups and reply tracking.

Legend:
- **P0** — resilience blockers: things that currently break campaigns or cost you hours.
- **P1** — high-impact reliability + the follow-up feature.
- **P2** — quality-of-life, observability, and growth features.
- **P3** — polish and longer-term bets.

---

## P0 — Kill the "auth error, please log out and redo OAuth" class of failures

These are the specific fixes that together make OAuth pain go away, without touching Google Cloud config.

- [ ] **Persistent, DB-backed sender-token store.** Move sender tokens (`refreshToken`, `accessToken`, `expiresAt`, `lastRefreshedAt`, `lastError`, `status`) out of `.env` and `packages/api/data/senders.json` into a real store — Railway Postgres or a SQLite file on a Railway volume. Redeploys must not wipe tokens. Rotation must be atomic (row-level write, not file rewrite).
- [ ] **Background token-refresh worker.** A cron inside the API process runs every 30 min and proactively refreshes every sender's access token well before expiry. Don't wait until send-time to discover a token is dead.
- [ ] **Classify refresh errors properly** in `packages/pipeline/src/gmail.ts`. Distinguish:
  - `invalid_grant` → refresh token revoked/expired, mark sender `needs_reconnect`.
  - `invalid_client` → config bug, alert ops, don't touch sender state.
  - Network / 5xx → transient, retry with exponential backoff (up to 5 attempts over ~5 min).
  Today everything gets treated the same and the user ends up logging out.
- [ ] **Pre-flight check on campaign launch.** Before `POST /api/pipeline/run` starts sending, ping `gmail.users.getProfile` for every sender the campaign will use. If any sender is red, return a structured response like `{ error: "sender_unavailable", senders: [{email, reason}] }` so the UI can render inline "Reconnect" buttons instead of a generic 500.
- [ ] **Inline reconnect flow in the dashboard.** When a sender is red, clicking "Reconnect" opens Google OAuth in a **popup** (not full redirect) and on success the dashboard updates the sender chip to green — without logging the user out of the dashboard. Uses the existing `GET /api/senders/auth?email=…` but with `window.open` + `postMessage` from the callback page.
- [ ] **Hot-swap senders mid-campaign.** If a sender's token dies after the campaign started, queue their remaining contacts back and route them to another available sender with budget. Campaign keeps running; user sees a non-blocking banner "1 sender paused — 12 contacts reassigned."
- [ ] **Never lose a contact to a crash: idempotent send ledger.** Add a `sends` table with `(campaignId, contactId, senderEmail, status, attemptedAt, gmailMessageId, error)`. Before each send, insert `pending` row; on success, update with `gmailMessageId`. Pipeline always resumes from the ledger, not from sheet state. Eliminates double-sends after a crash and makes "retry failed sends" trivial.
- [ ] **Campaign state machine + pause/resume.** Campaigns get explicit states: `queued | running | paused | completed | failed`. User can pause from the dashboard. Pausing is respected mid-batch (between contacts). Crashed API → campaign auto-resumes on boot from the ledger.

## P1 — Resilience everywhere the API talks to the outside world

- [ ] **Google API retry + circuit breaker.** Wrap every Gmail and Sheets call with:
  - retry on 429 / 5xx using jittered exponential backoff (1s → 30s, max 6 tries),
  - circuit breaker: after 20 failures in 2 min, open the circuit, pause the pipeline, and emit an incident event instead of hammering Google.
- [ ] **Sheets write serialization.** Today each contact's status update is an individual `values.update` call. Replace with a per-batch queue that coalesces writes into a single `values.batchUpdate`, with retry + idempotency. Prevents 429s and partial updates.
- [ ] **Structured campaign-run records.** The existing fire-and-forget `POST /api/pipeline/run` in `packages/api/src/routes/pipeline.ts` responds before the job is done and drops errors on the floor. Persist a `campaign_runs` row (`runId`, `campaignId`, `status`, `startedAt`, `finishedAt`, `counts`, `errors[]`). `/api/pipeline/status` polls it. UI surfaces per-run errors instead of the user staring at a spinner.
- [ ] **Dead-letter queue for failed sends.** Failed contacts stay in the ledger with `status=failed` and a reason. Dashboard shows a "Failed sends (12)" tab with a bulk "Retry" button.
- [ ] **Pre-send email validation pass.** Before Gmail quota is spent, run MX lookup + disposable-domain check on batch recipients. Mark invalid rows in the sheet so the pipeline skips them and the user sees why.
- [ ] **Warm-up schedule to protect deliverability.** Ramp daily send limit per new sender automatically: 5 → 10 → 20 → 40 over the first two weeks. Stored per sender in the DB, enforced by the scheduler.
- [ ] **Rate-aware scheduler.** Each sender gets a per-day and per-hour budget. Scheduler never exceeds it even if the user clicks "Run" five times. Simple counter in the ledger, not in memory.
- [ ] **Graceful startup/shutdown.** On SIGTERM (Railway redeploy), the API should: stop accepting new campaign runs, drain the current batch to a clean contact boundary, mark the run `paused`, exit. On boot, resume `paused` runs. No more "redeploy == dropped campaign."

## P1 — Follow-up sequences (big-picture feature)

The thing that actually grows reply rates. Design follows the resilience patterns above.

- [ ] **Data model: sequences.** A campaign owns an ordered list of `steps`, each with `{ delayDays, template (en + fr), stopOnReply: true, stopOnOpen: false }`. Default: 3 steps at 0 / 4 / 9 days.
- [ ] **Sheet schema extension.** Add columns per touch: `touch1_sent_at`, `touch1_opened_at`, `touch1_gmail_msg_id`, … up to touch3. Migration script idempotently adds missing columns.
- [ ] **Follow-up scheduler job.** Separate cron every 15 min: finds contacts whose `touchN_sent_at` is ≥ step delay, have no reply, haven't opted out, and enqueues touch N+1 using the same sender + same Gmail thread (`In-Reply-To` + `References` headers) so follow-ups land as replies in the original thread.
- [ ] **Reply detection.** For every sent email, store the Gmail `threadId`. Poll `users.threads.get` on a rolling window (last 30 days of active threads) every 10 min. If the thread has a new message from outside `@alpic.ai`, mark contact `replied_at`, write to sheet, and stop the sequence.
- [ ] **Bounce detection.** Same polling loop looks for `Delivery Status Notification` / `mailer-daemon` messages in the sender's inbox addressed to our thread, flags the contact as bounced, removes from the queue.
- [ ] **Opt-out handling.** Add a one-click unsubscribe link (stateless HMAC token → `packages/tracking-server/api/optout/[token]`). Endpoint marks contact opted out, sheet updated, all future touches skipped. Add `List-Unsubscribe` header too — improves deliverability.
- [ ] **Sequence editor in the wizard.** Extend `CampaignWizard` with a new step "Follow-ups": add/remove steps, edit template per step, preview the full sequence for one contact. Keep the existing single-email flow as "1-step sequence."
- [ ] **Thread view in dashboard.** Per-contact drawer showing the full conversation (sent emails + replies + opens/clicks timeline). Powered by the ledger + reply polling.

## P2 — Observability, testing, and platform hardening

- [ ] **Structured logging + request IDs.** pino everywhere, with `campaignRunId` / `contactId` / `senderEmail` on every line. Makes "why did this send fail?" a 5-second grep on Railway.
- [ ] **Metrics + health.** `/api/health` returns `{ ok, dbOk, sendersHealthy, sendersDegraded, lastRunStatus }`. Railway health checks point at it. Bonus: a `/api/metrics` Prometheus-style endpoint so Grafana Cloud (free tier) can chart sends/day and token health.
- [ ] **Incident webhook.** When a circuit breaker opens, a sender hits `needs_reconnect`, or a run fails, post to a Slack/Discord webhook so you find out before you notice.
- [ ] **Automated tests where the risk is.** Start small, cover the resilience paths first:
  - `packages/pipeline/gmail.test.ts`: mocked Gmail client, asserts retry + token-refresh classification.
  - `packages/api/routes/senders.test.ts`: OAuth callback happy path + revoked-token path.
  - `packages/api/routes/pipeline.test.ts`: run kicks off, ledger populated, crash recovery works.
- [ ] **Typecheck + lint + CI.** `npm run check` across all packages, GitHub Actions runs it on PR.
- [ ] **Dashboard "System Health" page.** Real-time view of every sender (green/yellow/red, last refresh, daily budget used), last 10 campaign runs, failed-sends count, circuit-breaker state. This is the UI you open when you suspect something's wrong — and it replaces the current "just try and see."
- [ ] **Break up monolith components.** `App.tsx` (1 059 lines) and `CampaignWizard.tsx` (1 211 lines) are unmaintainable. Extract analytics widgets and wizard steps into their own files. Non-functional but unlocks the features above.
- [ ] **Type-safe sheet column map** in `packages/pipeline/src/sheets.ts` — today column letters like `W` / `X` are magic strings, so adding the touch2/touch3 columns will break things silently. One enum + typed row accessor fixes it.
- [ ] **Repo hygiene:** add `.env`, `.env.*`, `packages/api/data/senders.json` to `.gitignore`; delete `packages/dashboard/.env.production.local` from the working tree (leave your Google Cloud config alone — this is just tidying the repo). Won't require any console changes.

## P3 — Growth features + longer-term bets

- [ ] **A/B test subject lines.** Campaign can carry two subjects, split 50/50, dashboard shows open-rate per variant with a significance indicator.
- [ ] **Schedule campaigns.** "Run this campaign Monday 8am Paris time" — queued as a future `campaign_run` row, scheduler picks it up.
- [ ] **Draft-only mode per sender.** Instead of sending, create Gmail drafts in the sender's account. Useful for people who want to review before sending.
- [ ] **CRM export.** One-click push of engaged contacts (replied / clicked) to HubSpot or Attio via their APIs.
- [ ] **Daily digest email.** Cron at 8am local sends the team a digest: sends yesterday, replies, opens, failures, sender health. Forces the human into the loop without needing to open the dashboard.
- [ ] **Multi-domain support.** Make the `@alpic.ai` allow-list an env var (`ALLOWED_EMAIL_DOMAINS`). Lets partners onboard.
- [ ] **Template library.** Save / reuse templates across campaigns, with variables and preview, stored per user.
- [ ] **Per-contact snooze.** "Don't touch this contact for 30 days." Respected by the scheduler.
- [ ] **Contact dedup across campaigns.** Prevent the same email receiving two different campaigns in the same week.

---

## The resilience theme in one paragraph

Every external call (Gmail, Sheets) must be retry-aware and circuit-broken. Every durable fact (tokens, campaigns, sends, replies) lives in a DB, not a JSON file or `.env`. Every failure mode has a classification → a UI state → a one-click recovery path (most importantly: the inline reconnect popup, so "re-do OAuth" stops meaning "log out"). Every restart resumes from the ledger, not from memory. Once those invariants hold, shipping follow-ups and reply detection is just more rows in the same tables.

## Suggested build order

1. DB + sender store + send ledger (unblocks everything else).
2. Token refresh worker + error classification + inline reconnect (kills the #1 pain).
3. Pre-flight checks + campaign state machine + graceful shutdown (campaigns stop dying mid-run).
4. Retry / circuit breaker + structured logging + health endpoint (observability).
5. Follow-up sequences + reply detection (the growth feature, on top of a now-solid platform).
6. A/B, scheduling, digests, CRM — flavor.
