import { Router, Request, Response } from 'express';
import { readSenders, upsertSender } from '../senders';
import { generateAuthUrl, exchangeCode, DASHBOARD_URL } from '../auth';

const router = Router();

// GET /api/senders — list connected senders + daily stats
router.get('/', (_req: Request, res: Response) => {
  const senders = readSenders();
  res.json(
    senders.map(s => ({
      email: s.email,
      name: s.name,
      dailyLimit: s.dailyLimit,
      sentToday: s.sentToday,
      remaining: s.dailyLimit - s.sentToday,
      connected: !!s.refreshToken,
    }))
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

export default router;
