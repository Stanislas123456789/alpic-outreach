import { Router, Request, Response } from 'express';
import { readSenders, syncSentCounts } from '../senders';

const router = Router();

// ─── Progress event type ──────────────────────────────────────────────────────

export interface ProgressEvent {
  type: 'start' | 'sending' | 'sent' | 'failed' | 'invalid' | 'skipped' | 'done';
  contactId?: string;
  email?: string;
  firstName?: string;
  company?: string;
  via?: string;
  error?: string;
  total?: number;
  index?: number;
  timestamp: string;
}

// ─── Campaign state ───────────────────────────────────────────────────────────

interface Campaign {
  id: string;
  sheetId: string;
  sheetTab: string;
  startedAt: string | null;
  scheduledAt: string | null;   // ISO string for scheduled start, null = run now
  status: 'scheduled' | 'running' | 'done' | 'error' | 'cancelled';
  sent: number;
  total: number;
  log: ProgressEvent[];
  error?: string;
  scheduledTimer?: ReturnType<typeof setTimeout>; // internal, not serialized
}

const campaigns = new Map<string, Campaign>();

// Backward-compat helpers
function getLastCampaign(): Campaign | undefined {
  let last: Campaign | undefined;
  for (const c of campaigns.values()) {
    if (!last) { last = c; continue; }
    const aTime = c.startedAt || c.scheduledAt || '';
    const bTime = last.startedAt || last.scheduledAt || '';
    if (aTime > bTime) last = c;
  }
  return last;
}

// ─── Start a campaign (shared logic) ─────────────────────────────────────────

async function executeCampaign(
  campaign: Campaign,
  excludeIds: string[],
  emailOverrides: Record<string, { subject: string; body: string }>,
) {
  campaign.status = 'running';
  campaign.startedAt = new Date().toISOString();

  try {
    const { runPipeline } = await import('../../../pipeline/src/index');
    const { setSenders, getSenders } = await import('../../../pipeline/src/gmail');

    const senders = readSenders().filter(s => !!s.refreshToken);
    setSenders(senders.map(s => ({ ...s })));

    await runPipeline({
      excludeIds,
      sheetId: campaign.sheetId || undefined,
      sheetTab: campaign.sheetTab || undefined,
      emailOverrides,
      onProgress: (event: ProgressEvent) => {
        campaign.log.push(event);
        if (event.type === 'start' && event.total != null) {
          campaign.total = event.total;
        }
        if (event.type === 'sent') {
          campaign.sent += 1;
        }
      },
    });

    syncSentCounts(getSenders());
    campaign.status = 'done';
    console.log(`[api] Campaign ${campaign.id} complete`);
  } catch (err: any) {
    campaign.status = 'error';
    campaign.error = err.message;
    console.error(`[api] Campaign ${campaign.id} error:`, err.message);
  } finally {
    campaign.log.push({ type: 'done', timestamp: new Date().toISOString() });
  }
}

// POST /api/pipeline/run — trigger a send batch immediately or schedule it
// Body: { excludeIds?, sheetId?, tab?, emailOverrides?, scheduledAt?, name? }
router.post('/run', async (req: Request, res: Response) => {
  const senders = readSenders().filter(s => !!s.refreshToken);
  if (senders.length === 0) {
    res.status(400).json({
      error: 'No senders connected. Connect a Gmail account first.',
    });
    return;
  }

  const excludeIds: string[] = req.body?.excludeIds || [];
  const sheetId: string = req.body?.sheetId || '';
  const sheetTab: string = req.body?.tab || '';
  const emailOverrides: Record<string, { subject: string; body: string }> = req.body?.emailOverrides || {};
  const scheduledAt: string | undefined = req.body?.scheduledAt;

  // Check if another campaign is already running for the same sheetId+sheetTab
  for (const c of campaigns.values()) {
    if (c.status === 'running' && c.sheetId === sheetId && c.sheetTab === sheetTab) {
      res.status(409).json({
        error: 'A campaign is already running for this sheet',
        campaignId: c.id,
      });
      return;
    }
  }

  const campaignId = Date.now().toString(36);
  const campaign: Campaign = {
    id: campaignId,
    sheetId,
    sheetTab,
    startedAt: null,
    scheduledAt: scheduledAt || null,
    status: 'scheduled',
    sent: 0,
    total: 0,
    log: [],
  };

  campaigns.set(campaignId, campaign);

  const now = new Date();
  const scheduleTime = scheduledAt ? new Date(scheduledAt) : null;
  const isInFuture = scheduleTime && scheduleTime > now;

  if (isInFuture) {
    const delay = scheduleTime.getTime() - now.getTime();
    campaign.scheduledTimer = setTimeout(() => {
      executeCampaign(campaign, excludeIds, emailOverrides);
    }, delay);

    res.json({
      ok: true,
      campaignId,
      message: `Campaign scheduled for ${scheduledAt}`,
    });
  } else {
    // Run immediately
    campaign.scheduledAt = null;
    res.json({
      ok: true,
      campaignId,
      message: 'Pipeline batch started',
      senderCount: senders.length,
      excluded: excludeIds.length,
    });

    // Run async after responding
    executeCampaign(campaign, excludeIds, emailOverrides);
  }
});

// GET /api/pipeline/progress — poll current send progress
// Optional ?campaignId=xxx — return specific campaign, or most recent if omitted
router.get('/progress', (req: Request, res: Response) => {
  const campaignId = req.query.campaignId as string | undefined;
  const campaign = campaignId ? campaigns.get(campaignId) : getLastCampaign();

  if (!campaign) {
    res.json({ running: false, total: 0, log: [] });
    return;
  }

  res.json({
    running: campaign.status === 'running',
    total: campaign.total,
    log: campaign.log,
    campaignId: campaign.id,
    sent: campaign.sent,
    status: campaign.status,
  });
});

// GET /api/pipeline/campaigns — list all campaigns
router.get('/campaigns', (_req: Request, res: Response) => {
  const list = Array.from(campaigns.values())
    .map(({ scheduledTimer, ...c }) => c)  // strip internal timer
    .sort((a, b) => (b.startedAt || b.scheduledAt || '').localeCompare(a.startedAt || a.scheduledAt || ''));
  res.json(list);
});

// DELETE /api/pipeline/campaigns/:id — cancel a scheduled campaign
router.delete('/campaigns/:id', (req: Request, res: Response) => {
  const c = campaigns.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campaign not found' });
  if (c.status !== 'scheduled') return res.status(409).json({ error: 'Can only cancel scheduled campaigns' });
  clearTimeout(c.scheduledTimer);
  c.status = 'cancelled';
  res.json({ ok: true });
});

// GET /api/pipeline/preview?sheetId=xxx&tab=TRAVEL&limit=5
// Returns pending contacts with generated subject + body — no emails sent
router.get('/preview', async (req: Request, res: Response) => {
  const sheetId = req.query.sheetId as string | undefined;
  const tab = req.query.tab as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string || '10'), 50);

  try {
    const { getPendingContacts } = await import('../../../pipeline/src/sheets');
    const { buildSubject, buildBody } = await import('../../../pipeline/src/template');
    const contacts = await getPendingContacts(limit, sheetId, tab);
    res.json(
      contacts.map(c => ({
        id: c.id,
        rowIndex: c.rowIndex,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        company: c.company,
        industry: c.industry,
        country: c.country,
        role: c.role,
        language: c.language,
        competitors: c.competitors,
        subject: buildSubject(c),
        body: buildBody(c),
      }))
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pipeline/status — current pipeline state + per-sender stats (backward compat)
router.get('/status', (_req: Request, res: Response) => {
  const senders = readSenders();
  const anyRunning = Array.from(campaigns.values()).some(c => c.status === 'running');
  const last = getLastCampaign();

  res.json({
    running: anyRunning,
    lastRunAt: last?.startedAt || null,
    lastRunResult: last ? (last.status === 'done' ? 'success' : last.status === 'error' ? 'error' : null) : null,
    lastRunError: last?.error || null,
    senders: senders.map(s => ({
      email: s.email,
      name: s.name,
      sentToday: s.sentToday,
      dailyLimit: s.dailyLimit,
      remaining: s.dailyLimit - s.sentToday,
    })),
  });
});

export default router;
