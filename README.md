# 🚀 Alpic Outreach Pipeline

Automated email outreach pipeline with real-time analytics dashboard.

---

## Architecture

```
Google Sheets (pipeline source & data store)
        ↓
  Pipeline (Node.js) ─── sends via Gmail API (multi-account)
        ↓                      ↓
  Tracker (cron)        Tracking Server (Vercel)
        ↓                      ↓
  Updates Sheet ←─── pixel opens + reply detection
        ↓
  Dashboard (React) ─── reads Sheet → analytics UI
```

---

## Quick Start

### 1. Clone & Install

```bash
git clone <repo>
cd alpic-outreach
npm install
```

### 2. Google Cloud Setup

#### A. Create a Google Cloud Project
1. Go to https://console.cloud.google.com
2. Create a new project: `alpic-outreach`
3. Enable APIs:
   - Google Sheets API
   - Gmail API

#### B. Service Account (for Sheets read/write)
1. IAM & Admin → Service Accounts → Create
2. Download JSON key
3. Share your Google Sheet with the service account email (Editor access)
4. Copy `client_email` and `private_key` into `.env`

#### C. OAuth2 Credentials (for Gmail sending)
1. APIs & Services → Credentials → OAuth 2.0 Client IDs
2. Type: Desktop App
3. Copy Client ID and Secret into `.env`
4. For each sender account, run:

```bash
npm run auth --workspace=packages/pipeline
```

Follow the URL, authorize, copy the refresh token into `.env` SENDERS array.

### 3. Configure Environment

```bash
cp .env.example .env
# Fill in all values
```

### 4. Add Tracking Headers to Sheet

The pipeline will auto-add these columns on first run:
`status | assigned_to | sent_at | message_id | thread_id | open_count | first_open_at | replied_at | bounce_reason | language`

Make sure your sheet has a `language` column (EN/FR/DE) or add it manually.

### 5. Dry Run (test without sending)

```bash
DRY_RUN=true npm run pipeline
```

This will preview all emails that would be sent without actually sending them.

### 6. Live Run

```bash
npm run pipeline
```

The pipeline will:
- Run immediately
- Then every 30 min (Mon-Fri, 8am-7pm)
- Check replies/bounces every 15 min
- Reset daily counters at midnight

---

## Deploy Tracking Server (Vercel)

```bash
cd packages/tracking-server
cp .env.example .env  # fill in Google credentials
npm install -g vercel
vercel login
vercel --prod
```

Set environment variables in Vercel dashboard:
- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`  
- `GOOGLE_PRIVATE_KEY`

Then update `.env` pipeline:
```
TRACKING_BASE_URL=https://your-project.vercel.app
```

---

## Deploy Dashboard (Vercel)

```bash
cd packages/dashboard
cp .env.example .env
# Create a Google API key restricted to Sheets API (read-only) at:
# console.cloud.google.com → APIs & Services → Credentials → API Keys
vercel --prod
```

---

## Pipeline Config

| Variable | Default | Description |
|---|---|---|
| `DRY_RUN` | `false` | Preview emails without sending |
| `MIN_DELAY_SECONDS` | `90` | Min wait between emails |
| `MAX_DELAY_SECONDS` | `180` | Max wait between emails |
| `GOOGLE_SHEET_TAB` | `Sheet1` | Sheet tab name |

---

## Sheet Column Mapping

Update `SHEET_COLUMNS` in `packages/pipeline/src/types.ts` if your column order differs.

Required columns (by index):
```
0: industry       7: email          17: status (auto)
1: sub_industry   8: country        18: assigned_to (auto)
2: company        9: region         19: sent_at (auto)
3: website        12: competitors   20: message_id (auto)
4: contact_name   15: urgency       21: thread_id (auto)
5: role           16: angle         22: open_count (auto)
6: linkedin       26: language      23: first_open_at (auto)
```

---

## Anti-Spam Best Practices

- ✅ 90-180s random delay between emails
- ✅ Max 80 emails/day/account (Gmail Workspace = 500/day hard limit)  
- ✅ MX record validation before sending
- ✅ HTML format (better deliverability than plain text)
- ✅ Tracking pixel for open detection
- ✅ Bounce detection via Gmail API
- ⚠️  Make sure SPF/DKIM/DMARC are configured for alpic.ai

Check your DNS setup: https://mxtoolbox.com/emailhealth/alpic.ai

---

## Repo Structure

```
alpic-outreach/
├── packages/
│   ├── pipeline/              # Sending engine (Node.js)
│   │   └── src/
│   │       ├── index.ts       # Main cron orchestrator
│   │       ├── sheets.ts      # Google Sheets read/write
│   │       ├── gmail.ts       # Multi-account Gmail sender
│   │       ├── template.ts    # Email template engine (EN/FR)
│   │       ├── validator.ts   # MX record validation
│   │       ├── tracker.ts     # Reply/bounce detection
│   │       ├── types.ts       # Shared types
│   │       └── auth.ts        # OAuth2 token generator
│   │
│   ├── tracking-server/       # Pixel tracking (Vercel)
│   │   └── api/pixel/[id].js
│   │
│   └── dashboard/             # Analytics UI (React + Vite)
│       └── src/
│           ├── App.tsx
│           ├── App.css
│           ├── types.ts
│           └── hooks/useSheets.ts
│
├── .env.example
├── .gitignore
└── README.md
```
