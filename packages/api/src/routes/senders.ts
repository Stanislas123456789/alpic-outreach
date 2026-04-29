import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { readSenders, upsertSender, writeSenders } from '../senders';
import { generateAuthUrl, exchangeCode, DASHBOARD_URL, createOAuthClient } from '../auth';
import { getAllSenderDailyCounts, isDbAvailable } from '../db';

const router = Router();

// GET /api/senders — list connected senders + daily stats
router.get('/', async (_req: Request, res: Response) => {
  const senders = readSenders();
  // Prefer Postgres daily counts (survives deploys) over in-memory counts
  let dbCounts: Record<string, number> = {};
  if (isDbAvailable()) {
    try { dbCounts = await getAllSenderDailyCounts(); } catch {}
  }
  res.json(
    senders.map(s => {
      const sentToday = dbCounts[s.email] ?? s.sentToday;
      return {
        email: s.email,
        name: s.name,
        dailyLimit: s.dailyLimit,
        sentToday,
        remaining: s.dailyLimit - sentToday,
        connected: !!s.refreshToken,
      };
    })
  );
});

// GET /api/senders/auth?email=xxx — redirect to Google OAuth for a new sender
router.get('/auth', (req: Request, res: Response) => {
  const email = req.query.email as string;
  if (!email?.endsWith('@alpic.ai')) {
    res.status(403).json({ error: 'Only @alpic.ai accounts are allowed.' });
    return;
  }
  const url = generateAuthUrl(email);
  res.redirect(url);
});

// GET /api/senders/auth/callback — Google OAuth callback
router.get('/auth/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const error = req.query.error as string;

  if (error) {
    res.redirect(`${DASHBOARD_URL}?tab=senders&error=${encodeURIComponent(error)}`);
    return;
  }

  if (!code) {
    res.status(400).send('Missing OAuth code');
    return;
  }

  try {
    const { refreshToken, email, name } = await exchangeCode(code);

    upsertSender({
      email,
      name,
      refreshToken,
      dailyLimit: 80,
    });

    console.log(`[api] Sender connected: ${email}`);
    res.redirect(`${DASHBOARD_URL}?tab=senders&connected=true&email=${encodeURIComponent(email)}`);
  } catch (err: any) {
    console.error('[api] OAuth callback error:', err.message);
    res.redirect(`${DASHBOARD_URL}?tab=senders&error=${encodeURIComponent(err.message)}`);
  }
});

// GET /api/senders/export — export full sender data including refresh tokens
// Use this to back up tokens before a Railway redeploy, then restore via /seed.
// Protected by the same @alpic.ai auth middleware as all other endpoints.
router.get('/export', (_req: Request, res: Response) => {
  res.json(readSenders());
});

// POST /api/senders/seed — overwrite senders.json (used to restore tokens after redeploy)
router.post('/seed', (req: Request, res: Response) => {
  const senders = req.body;
  if (!Array.isArray(senders)) {
    res.status(400).json({ error: 'Body must be an array of senders' });
    return;
  }
  writeSenders(senders);
  res.json({ ok: true, count: senders.length });
});

// GET /api/senders/health — verify each sender's token is still valid
router.get('/health', async (_req: Request, res: Response) => {
  const senders = readSenders();
  const results = await Promise.all(
    senders.map(async sender => {
      if (!sender.refreshToken) {
        return { email: sender.email, name: sender.name, status: 'disconnected' as const };
      }
      try {
        const client = createOAuthClient();
        client.setCredentials({ refresh_token: sender.refreshToken });
        const gmail = google.gmail({ version: 'v1', auth: client });
        await gmail.users.getProfile({ userId: 'me' });
        return { email: sender.email, name: sender.name, status: 'ok' as const };
      } catch (err: any) {
        const msg: string = err.message || '';
        const isInvalidGrant = /invalid_grant/i.test(msg);
        return {
          email: sender.email,
          name: sender.name,
          status: 'error' as const,
          reason: msg,
          ...(isInvalidGrant ? { needsReconnect: true } : {}),
        };
      }
    })
  );
  const ok = results.every(r => r.status === 'ok');
  res.json({ ok, senders: results });
});

// PATCH /api/senders/:email — update sender settings (e.g. dailyLimit)
router.patch('/:email', (req: Request, res: Response) => {
  const { email } = req.params;
  const { dailyLimit } = req.body || {};

  if (dailyLimit !== undefined) {
    const limit = Number(dailyLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 2000) {
      res.status(400).json({ error: 'dailyLimit must be an integer between 1 and 2000' });
      return;
    }
  }

  const senders = readSenders();
  const idx = senders.findIndex(s => s.email === email);
  if (idx < 0) {
    res.status(404).json({ error: 'Sender not found' });
    return;
  }

  if (dailyLimit !== undefined) {
    senders[idx].dailyLimit = Number(dailyLimit);
  }

  writeSenders(senders);
  res.json({ ok: true, sender: { email: senders[idx].email, dailyLimit: senders[idx].dailyLimit } });
});

// DELETE /api/senders/:email — disconnect a sender (clears refresh token)
router.delete('/:email', (req: Request, res: Response) => {
  const { email } = req.params;
  const senders = readSenders();
  const idx = senders.findIndex(s => s.email === email);
  if (idx < 0) {
    res.status(404).json({ error: 'Sender not found' });
    return;
  }
  senders[idx] = { ...senders[idx], refreshToken: '' };
  writeSenders(senders);
  console.log(`[api] Sender disconnected: ${email}`);
  res.json({ ok: true });
});

export default router;
