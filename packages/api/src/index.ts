// ============================================
// ALPIC OUTREACH API SERVER
// ============================================
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

import sendersRouter from './routes/senders';
import pipelineRouter, { getUniqueCampaignSheets } from './routes/pipeline';
import {
  readSenders,
  resetDailyCountersIfNeeded,
  syncSentCounts,
  updateRefreshToken,
} from './senders';
import { DASHBOARD_URL, API_PORT } from './auth';

// Re-export for external use
export { DASHBOARD_URL, API_PORT };

const START_CRON = process.env.START_PIPELINE_CRON === 'true';

const app = express();

// ─── CORS ─────────────────────────────────────────────────────────────────────

const allowedOrigins = [
  'http://localhost:3001',
  DASHBOARD_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server or same-origin requests
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked: ${origin}`));
    }
  },
  credentials: true,
}));

app.use(express.json());

// ─── Auth middleware ──────────────────────────────────────────────────────────
// OAuth callback endpoints don't need a token — they ARE the auth flow.

function requireAlpicEmail(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  // Allow OAuth redirect endpoints through without a session header
  if (
    req.path === '/api/senders/auth' ||
    req.path === '/api/senders/auth/callback' ||
    req.path === '/health' ||
    req.path === '/api/diag' ||
    req.path.startsWith('/pixel/')
  ) {
    next();
    return;
  }
  const email = req.headers['x-auth-email'] as string | undefined;
  if (!email?.endsWith('@alpic.ai')) {
    res.status(401).json({ error: 'Unauthorized. Must be an @alpic.ai account.' });
    return;
  }
  next();
}

app.use(requireAlpicEmail);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api/senders', sendersRouter);
app.use('/api/pipeline', pipelineRouter);

app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ─── Open tracking pixel ──────────────────────────────────────────────────────
// Called when an email recipient opens the email (1x1 transparent gif embedded).
// No auth required — this endpoint is hit by the recipient's email client.
app.get('/pixel/:contactId', async (req, res) => {
  // Return the pixel immediately so the email client isn't kept waiting
  const pixel = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
  );
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.end(pixel);

  // Then increment open count asynchronously
  try {
    const rowIndex = parseInt(req.query.row as string);
    const sheetId = (req.query.sheetId as string) || process.env.GOOGLE_SHEET_ID;
    const sheetTab = (req.query.tab as string) || process.env.GOOGLE_SHEET_TAB || 'Master Table';
    if (!rowIndex || rowIndex < 2) return;

    const { incrementOpenCount, getSentContacts, updateContactStatus } = await import('../../pipeline/src/sheets');
    // Look up current open count for this row
    const contacts = await getSentContacts(sheetId, sheetTab);
    const contact = contacts.find(c => c.rowIndex === rowIndex);
    if (!contact) return;

    const now = new Date().toISOString();
    await incrementOpenCount(rowIndex, contact.openCount || 0, now, sheetId, sheetTab);

    // Also update status to "opened" if it was just "sent"
    if (contact.status === 'sent') {
      await updateContactStatus(rowIndex, { status: 'opened' }, sheetId, sheetTab);
    }

    console.log(`[pixel] Open tracked: row=${rowIndex} contact=${contact.email} opens=${(contact.openCount || 0) + 1}`);
  } catch (err: any) {
    console.error('[pixel] Error tracking open:', err.message);
  }
});

// GET /api/diag — diagnose credentials without exposing secrets
app.get('/api/diag', async (_req, res) => {
  const results: Record<string, string> = {};

  // Check env vars presence
  results.GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID ? 'set' : 'MISSING';
  results.GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET ? 'set' : 'MISSING';
  results.GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'MISSING';
  results.GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID ? 'set' : 'MISSING';

  // Check PEM key format
  const rawKey = process.env.GOOGLE_PRIVATE_KEY || '';
  if (!rawKey) {
    results.GOOGLE_PRIVATE_KEY = 'MISSING';
  } else {
    const hasBegin = rawKey.includes('-----BEGIN');
    const hasEnd = rawKey.includes('-----END');
    const hasLiteralN = rawKey.includes('\\n');
    const hasRealNewline = rawKey.includes('\n');
    results.GOOGLE_PRIVATE_KEY_raw = `${rawKey.length} chars, BEGIN:${hasBegin}, END:${hasEnd}, literal\\n:${hasLiteralN}, realNewline:${hasRealNewline}`;

    // Show what parsePemKey produces
    try {
      let key = rawKey.trim();
      if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
        try { key = JSON.parse(key); } catch { key = key.slice(1, -1); }
      }
      key = key.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const lines = key.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
      const parsed = lines.join('\n');
      const lineCount = lines.length;
      const bodyLines = lines.filter((l: string) => !l.startsWith('-----'));
      const invalidChars = bodyLines.join('').replace(/[A-Za-z0-9+/=]/g, '').length;
      results.GOOGLE_PRIVATE_KEY_parsed = `${parsed.length} chars, ${lineCount} lines, ${invalidChars} invalid base64 chars`;
      results.GOOGLE_PRIVATE_KEY_firstLine = lines[0] || 'EMPTY';
      results.GOOGLE_PRIVATE_KEY_lastLine = lines[lines.length - 1] || 'EMPTY';
    } catch (e: any) {
      results.GOOGLE_PRIVATE_KEY_parsed = `parse error: ${e.message}`;
    }
  }

  // Test stripped key with crypto.createPrivateKey
  try {
    const rawKey2 = process.env.GOOGLE_PRIVATE_KEY || '';
    let k = rawKey2.trim();
    k = k.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    k = k.replace(/\\n/g, '\n');
    const lns = k.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
    const stripped = lns.map((l: string) => l.startsWith('-----') ? l : l.replace(/[^A-Za-z0-9+/=]/g, '')).filter((l: string) => l.length > 0).join('\n');
    const remInvalid = lns.filter((l: string) => !l.startsWith('-----')).map((l: string) => l.replace(/[^A-Za-z0-9+/=]/g, '')).join('').replace(/[A-Za-z0-9+/=]/g, '').length;
    results.GOOGLE_PRIVATE_KEY_after_strip = `${stripped.length} chars, ${remInvalid} invalid chars remaining`;
    const keyObj = crypto.createPrivateKey(stripped);
    results.GOOGLE_PRIVATE_KEY_crypto = `OK: ${keyObj.asymmetricKeyType}`;
  } catch (e: any) {
    results.GOOGLE_PRIVATE_KEY_crypto = `ERROR: ${e.message}`;
  }

  // Test GOOGLE_SERVICE_ACCOUNT_JSON key
  const jsonCredsRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (jsonCredsRaw) {
    try {
      const creds = JSON.parse(jsonCredsRaw);
      const jk: string = creds.private_key || '';
      results.JSON_key_length = `${jk.length} chars, hasRealNewlines:${jk.includes('\n')}, hasLiteralSlashN:${jk.includes('\\n')}`;
      const jkStripped = jk.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0)
        .map((l: string) => l.startsWith('-----') ? l : l.replace(/[^A-Za-z0-9+/=]/g, '')).filter((l: string) => l.length > 0).join('\n');
      const jkInvalid = jkStripped.split('\n').filter((l: string) => !l.startsWith('-----')).join('').replace(/[A-Za-z0-9+/=]/g, '').length;
      results.JSON_key_stripped = `${jkStripped.length} chars, ${jkInvalid} invalid chars after strip`;
      const jKeyObj = crypto.createPrivateKey(jkStripped);
      results.JSON_key_crypto = `OK: ${jKeyObj.asymmetricKeyType}`;
    } catch (e: any) {
      results.JSON_key_crypto = `ERROR: ${e.message}`;
    }
  } else {
    results.JSON_key_crypto = 'GOOGLE_SERVICE_ACCOUNT_JSON not set';
  }

  // Test Google Sheets connection
  try {
    const { getPendingContacts } = await import('../../pipeline/src/sheets');
    const contacts = await getPendingContacts(1);
    results.sheetsTest = `OK — ${contacts.length} pending contact(s) fetched`;
  } catch (err: any) {
    results.sheetsTest = `ERROR: ${err.message}`;
  }

  // Test senders
  const senders = readSenders();
  results.senders = `${senders.length} stored, ${senders.filter(s => !!s.refreshToken).length} with tokens`;

  res.json(results);
});

// ─── Startup ──────────────────────────────────────────────────────────────────

// Wire token rotation → update senders.json (not .env)
function wireTokenRotation() {
  // We need to import setTokenRotationCallback from the pipeline module.
  // Do it lazily to avoid running the pipeline entry point.
  import('../../pipeline/src/gmail').then(({ setTokenRotationCallback: setPipelineCb }) => {
    setPipelineCb((email: string, token: string) => {
      updateRefreshToken(email, token);
      console.log(`[api] Rotated token saved for ${email}`);
    });
  }).catch(() => {
    // Pipeline module not available — skip (shouldn't happen in monorepo)
  });
}

// ─── Pipeline cron (only when START_PIPELINE_CRON=true) ──────────────────────

async function startPipelineCron() {
  const { runPipeline } = await import('../../pipeline/src/index');
  const { setSenders, getSenders } = await import('../../pipeline/src/gmail');
  const { checkReplies, checkBounces } = await import('../../pipeline/src/tracker');

  // Main pipeline: every 30 min, Mon–Fri, 8am–7pm
  cron.schedule('*/30 8-19 * * 1-5', async () => {
    console.log('⏰ [cron] Pipeline run triggered');
    resetDailyCountersIfNeeded();
    const senders = readSenders().filter(s => !!s.refreshToken);
    if (senders.length === 0) {
      console.log('[cron] No connected senders — skipping');
      return;
    }
    setSenders(senders.map(s => ({ ...s })));
    await runPipeline().catch(err => console.error('[cron] Pipeline error:', err));
    syncSentCounts(getSenders());
  });

  // Reply / bounce check: every 15 min — runs on all unique sheets used by
  // recent campaigns so non-default-sheet contacts are tracked correctly.
  cron.schedule('*/15 * * * *', async () => {
    const sheetTargets = getUniqueCampaignSheets();
    for (const { sheetId, sheetTab } of sheetTargets) {
      await checkReplies(sheetId, sheetTab)
        .catch(err => console.error(`[cron] Reply check error (${sheetTab}):`, err));
      await checkBounces(sheetId, sheetTab)
        .catch(err => console.error(`[cron] Bounce check error (${sheetTab}):`, err));
    }
  });

  // Reset daily counters at midnight
  cron.schedule('0 0 * * *', () => {
    resetDailyCountersIfNeeded();
  });

  console.log('✅ Pipeline cron jobs active (Mon–Fri 8am–7pm)');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

resetDailyCountersIfNeeded();
wireTokenRotation();

if (START_CRON) {
  startPipelineCron().catch(err => {
    console.error('Failed to start pipeline cron:', err);
  });
}

app.listen(API_PORT, () => {
  console.log(`
  ╔═══════════════════════════════════╗
  ║   ALPIC OUTREACH API v1.0         ║
  ║   http://localhost:${API_PORT}          ║
  ║   Pipeline cron: ${START_CRON ? 'ENABLED ' : 'DISABLED'}        ║
  ╚═══════════════════════════════════╝
  `);
});
