// ============================================
// ALPIC OUTREACH API SERVER
// ============================================
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import dotenv from 'dotenv';
dotenv.config();

import sendersRouter from './routes/senders';
import pipelineRouter from './routes/pipeline';
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
    req.path === '/health'
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

  // Reply / bounce check: every 15 min
  cron.schedule('*/15 * * * *', async () => {
    await checkReplies().catch(err => console.error('[cron] Reply check error:', err));
    await checkBounces().catch(err => console.error('[cron] Bounce check error:', err));
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
