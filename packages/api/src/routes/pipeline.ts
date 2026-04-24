import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
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

export interface CampaignFollowUp {
  enabled: boolean;
  delayDays: number;
  subjectEn: string;
  subjectFr: string;
  bodyEn: string;
  bodyFr: string;
}

interface Campaign {
  id: string;
  name?: string;
  sheetId: string;
  sheetTab: string;
  startedAt: string | null;
  scheduledAt: string | null;
  status: 'scheduled' | 'running' | 'done' | 'error' | 'cancelled';
  sent: number;
  total: number;
  log: ProgressEvent[];
  error?: string;
  followUp?: CampaignFollowUp;
  scheduledTimer?: ReturnType<typeof setTimeout>; // internal, not serialized
}

// ─── Disk persistence ─────────────────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const CAMPAIGNS_FILE = path.join(DATA_DIR, 'campaigns.json');

function loadCampaigns(): Map<string, Campaign> {
  try {
    if (fs.existsSync(CAMPAIGNS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CAMPAIGNS_FILE, 'utf8'));
      const map = new Map<string, Campaign>();
      for (const [id, c] of Object.entries(raw as Record<string, Campaign>)) {
        // Any campaign that was "running" at shutdown is now "error"
        if ((c as Campaign).status === 'running') (c as Campaign).status = 'error';
        map.set(id, c as Campaign);
      }
      console.log(`[campaigns] Loaded ${map.size} campaigns from disk`);
      return map;
    }
  } catch (err) {
    console.error('[campaigns] Failed to load from disk:', err);
  }
  return new Map();
}

function saveCampaigns(map: Map<string, Campaign>): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const obj: Record<string, Omit<Campaign, 'scheduledTimer'>> = {};
    for (const [id, c] of map) {
      const { scheduledTimer, ...rest } = c;
      // Only persist last 50 campaigns to keep file small
      obj[id] = rest;
    }
    // Trim to last 50 by startedAt
    const entries = Object.entries(obj)
      .sort(([, a], [, b]) =>
        (b.startedAt || b.scheduledAt || '').localeCompare(a.startedAt || a.scheduledAt || ''))
      .slice(0, 50);
    fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify(Object.fromEntries(entries), null, 2));
  } catch (err) {
    console.error('[campaigns] Failed to save to disk:', err);
  }
}

const campaigns = loadCampaigns();

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Returns unique {sheetId, sheetTab} pairs from all known campaigns (recent first).
// Used by the cron to run reply/bounce checks across every active sheet.
export function getUniqueCampaignSheets(): { sheetId: string; sheetTab: string }[] {
  const seen = new Set<string>();
  const result: { sheetId: string; sheetTab: string }[] = [];
  const sorted = Array.from(campaigns.values())
    .sort((a, b) => (b.startedAt || b.scheduledAt || '').localeCompare(a.startedAt || a.scheduledAt || ''));
  for (const c of sorted) {
    if (!c.sheetId) continue;
    const key = `${c.sheetId}::${c.sheetTab}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ sheetId: c.sheetId, sheetTab: c.sheetTab });
    }
  }
  // Always include the env-var default sheet so the cron works even with no campaigns
  const defaultId = process.env.GOOGLE_SHEET_ID || '';
  const defaultTab = process.env.GOOGLE_SHEET_TAB || 'Sheet1';
  const defaultKey = `${defaultId}::${defaultTab}`;
  if (defaultId && !seen.has(defaultKey)) {
    result.push({ sheetId: defaultId, sheetTab: defaultTab });
  }
  return result;
}

// Returns unique {sheetId, sheetTab, followUp} combos for campaigns with follow-up enabled
export function getFollowUpConfigs(): { sheetId: string; sheetTab: string; followUp: CampaignFollowUp }[] {
  const seen = new Set<string>();
  const result: { sheetId: string; sheetTab: string; followUp: CampaignFollowUp }[] = [];
  const sorted = Array.from(campaigns.values())
    .filter(c => c.followUp?.enabled)
    .sort((a, b) => (b.startedAt || b.scheduledAt || '').localeCompare(a.startedAt || a.scheduledAt || ''));
  for (const c of sorted) {
    const key = `${c.sheetId}::${c.sheetTab}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ sheetId: c.sheetId, sheetTab: c.sheetTab, followUp: c.followUp! });
    }
  }
  return result;
}

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

// Speed mode → delay range (in ms)
function speedToDelays(speedMode?: string): { minDelay: number; maxDelay: number } {
  if (speedMode === 'slow') return { minDelay: 180_000, maxDelay: 300_000 };  // 3–5 min
  if (speedMode === 'fast') return { minDelay: 30_000,  maxDelay: 60_000  };  // 30–60 sec
  return { minDelay: 90_000, maxDelay: 180_000 }; // normal: 90–180 sec
}

async function executeCampaign(
  campaign: Campaign,
  excludeIds: string[],
  emailOverrides: Record<string, { subject: string; body: string }>,
  maxEmails?: number,
  speedMode?: string,
  draftMode?: boolean,
  senderEmail?: string,
) {
  campaign.status = 'running';
  campaign.startedAt = new Date().toISOString();

  const { minDelay, maxDelay } = speedToDelays(speedMode);

  try {
    const { runPipeline } = await import('../../../pipeline/src/index');
    const { setSenders, getSenders } = await import('../../../pipeline/src/gmail');
    const { setUserSheetsToken } = await import('../../../pipeline/src/sheets');

    let senders = readSenders().filter(s => !!s.refreshToken);
    // If a specific sender was requested, restrict to that sender only.
    // This ensures each user's campaign sends only from their own email.
    if (senderEmail) {
      const matched = senders.filter(s => s.email === senderEmail);
      if (matched.length > 0) senders = matched;
    }
    setSenders(senders.map(s => ({ ...s })));
    // Use the campaign sender's token for Sheets auth
    const sheetsToken = senders[0]?.refreshToken ?? null;
    setUserSheetsToken(sheetsToken);

    await runPipeline({
      excludeIds,
      sheetId: campaign.sheetId || undefined,
      sheetTab: campaign.sheetTab || undefined,
      emailOverrides,
      maxEmails,
      minDelay,
      maxDelay,
      draftMode,
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
    saveCampaigns(campaigns);
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
  const maxEmails: number | undefined = req.body?.maxEmails ? Number(req.body.maxEmails) : undefined;
  const speedMode: string | undefined = req.body?.speedMode;
  const draftMode: boolean = req.body?.draftMode === true;
  // senderEmail restricts sending to a single sender account — prevents cross-user email mixing
  const senderEmail: string | undefined = req.body?.senderEmail || (req.headers['x-auth-email'] as string | undefined);

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
  const name: string | undefined = req.body?.name;
  const followUpRaw = req.body?.followUp;
  const followUp: CampaignFollowUp | undefined = followUpRaw?.enabled ? {
    enabled: true,
    delayDays: Number(followUpRaw.delayDays) || 4,
    subjectEn: followUpRaw.subjectEn || '',
    subjectFr: followUpRaw.subjectFr || '',
    bodyEn: followUpRaw.bodyEn || '',
    bodyFr: followUpRaw.bodyFr || '',
  } : undefined;
  const campaign: Campaign = {
    id: campaignId,
    name,
    sheetId,
    sheetTab,
    startedAt: null,
    scheduledAt: scheduledAt || null,
    status: 'scheduled',
    sent: 0,
    total: 0,
    log: [],
    followUp,
  };

  campaigns.set(campaignId, campaign);

  const now = new Date();
  const scheduleTime = scheduledAt ? new Date(scheduledAt) : null;
  const isInFuture = scheduleTime && scheduleTime > now;

  if (isInFuture) {
    const delay = scheduleTime.getTime() - now.getTime();
    campaign.scheduledTimer = setTimeout(() => {
      executeCampaign(campaign, excludeIds, emailOverrides, maxEmails, speedMode, draftMode, senderEmail);
    }, delay);

    saveCampaigns(campaigns);
    res.json({
      ok: true,
      campaignId,
      message: `Campaign scheduled for ${scheduledAt}`,
    });
  } else {
    // Run immediately
    campaign.scheduledAt = null;
    saveCampaigns(campaigns);
    res.json({
      ok: true,
      campaignId,
      message: draftMode ? 'Draft campaign started' : 'Pipeline batch started',
      senderCount: senders.length,
      excluded: excludeIds.length,
      draftMode,
    });

    // Run async after responding
    executeCampaign(campaign, excludeIds, emailOverrides, maxEmails, speedMode, draftMode, senderEmail);
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
  saveCampaigns(campaigns);
  res.json({ ok: true });
});

// GET /api/pipeline/campaigns/:id — get single campaign with full log
router.get('/campaigns/:id', (req: Request, res: Response) => {
  const c = campaigns.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campaign not found' });
  const { scheduledTimer, ...rest } = c;
  res.json(rest);
});

// GET /api/pipeline/preview?sheetId=xxx&tab=TRAVEL&limit=5&includeSent=true
// Returns pending contacts with generated subject + body — no emails sent
// Pass includeSent=true to also include already-sent contacts (for dedup UI)
router.get('/preview', async (req: Request, res: Response) => {
  const sheetId = req.query.sheetId as string | undefined;
  const tab = req.query.tab as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string || '10'), 500);
  const includeSent = req.query.includeSent === 'true';

  try {
    const { getPendingContacts, getAllContactedContacts, setUserSheetsToken } = await import('../../../pipeline/src/sheets');
    const { buildSubject, buildBody } = await import('../../../pipeline/src/template');

    const senders = readSenders().filter(s => !!s.refreshToken);
    if (senders.length === 0) throw new Error('No senders connected');
    // Prefer the requesting user's own token for Sheets auth
    const userEmail = req.headers['x-auth-email'] as string | undefined;
    const preferred = (userEmail && senders.find(s => s.email === userEmail)) || senders[0];
    setUserSheetsToken(preferred.refreshToken);

    const pending = await getPendingContacts(limit, sheetId, tab);
    // Use getAllContactedContacts so the "already sent" count includes replied/bounced/yes/oui
    // rows — matching the KPI strip's total-sent number.
    const sentCount = includeSent ? (await getAllContactedContacts(sheetId, tab)).length : undefined;

    const mapped = pending.map(c => ({
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
      competitorsLive: c.competitorsLive,
      profileGroup: c.profileGroup,
      weekAdded: c.weekAdded,
      subject: c.emailSubject || buildSubject(c),
      body: c.emailBody || buildBody(c),
      alreadySent: false,
    }));

    // When includeSent requested, also fetch all contacted rows so the UI can
    // show them grayed-out (dedup). getAllContactedContacts covers sent/opened/
    // replied/bounced/yes/oui + any row with sentAt or threadId.
    if (includeSent) {
      const sent = await getAllContactedContacts(sheetId, tab);
      const sentMapped = sent.slice(0, 500).map(c => ({
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
        competitorsLive: c.competitorsLive || '',
        profileGroup: c.profileGroup || '',
        weekAdded: c.weekAdded || '',
        subject: '',
        body: '',
        alreadySent: true,
      }));
      res.json([...mapped, ...sentMapped]);
    } else {
      res.json(mapped);
    }
  } catch (err: any) {
    const msg = err.message || '';
    const isPermission = /insufficient.?permission|403|forbidden|permission.?denied|caller does not have|authentication scopes|no senders connected/i.test(msg);
    const noSenders = /no senders/i.test(msg);
    const message = noSenders
      ? 'No Gmail sender connected — go to Settings → Senders and connect a Gmail account first, then retry.'
      : isPermission
        ? 'Sheets permission denied — go to Settings → Senders and reconnect your Gmail account to refresh access, then retry.'
        : msg;
    res.status(isPermission || noSenders ? 403 : 500).json({ error: message });
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

// GET /api/pipeline/auth-debug — diagnose Google auth env vars (no secrets exposed)
router.get('/auth-debug', (_req: Request, res: Response) => {
  const jsonCreds = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;

  let jsonInfo: Record<string, unknown> = { present: false };
  if (jsonCreds) {
    try {
      const creds = JSON.parse(jsonCreds);
      const key = creds.private_key as string || '';
      jsonInfo = {
        present: true,
        parseOk: true,
        clientEmail: creds.client_email,
        keyLength: key.length,
        keyHasRealNewlines: key.includes('\n'),
        keyHasLiteralSlashN: key.includes('\\n'),
        keyStarts: key.substring(0, 30),
      };
    } catch (e: any) {
      jsonInfo = { present: true, parseOk: false, error: e.message, first100: jsonCreds.substring(0, 100) };
    }
  }

  res.json({
    GOOGLE_SERVICE_ACCOUNT_JSON: jsonInfo,
    GOOGLE_SERVICE_ACCOUNT_EMAIL: email ? `set (${email})` : 'not set',
    GOOGLE_PRIVATE_KEY: rawKey
      ? { present: true, length: rawKey.length, hasRealNewlines: rawKey.includes('\n'), hasLiteralSlashN: rawKey.includes('\\n') }
      : { present: false },
  });
});

// GET /api/pipeline/sheet-headers — returns actual column headers from the sheet
// so you can verify SHEET_COLUMNS indices match the real layout.
router.get('/sheet-headers', async (req: Request, res: Response) => {
  try {
    const { getSheetHeaders } = await import('../../../pipeline/src/sheets');
    const sheetId  = req.query.sheetId  as string | undefined;
    const sheetTab = req.query.sheetTab as string | undefined;
    const headers = await getSheetHeaders(sheetId, sheetTab);
    res.json({ ok: true, headers });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/pipeline/run-tracker — manually trigger reply + bounce checks
// for all unique campaign sheets. Pass lookbackDays (default 30) to override
// the bounce search window (useful for checking old campaigns retroactively).
router.post('/run-tracker', async (req: Request, res: Response) => {
  try {
    const { checkReplies, checkBounces } = await import('../../../pipeline/src/tracker');
    const { setSenders } = await import('../../../pipeline/src/gmail');
    // Inject senders from the API store so the pipeline module can use them
    const senders = readSenders().filter(s => !!s.refreshToken);
    setSenders(senders.map(s => ({ ...s })));
    const lookbackDays: number = parseInt(req.body?.lookbackDays) || 30;
    const sheetTargets = getUniqueCampaignSheets();

    // If no campaigns recorded yet, fall back to the default configured sheet
    const targets = sheetTargets.length > 0
      ? sheetTargets
      : [{ sheetId: undefined as any, sheetTab: undefined as any }];

    const results: Record<string, string> = {};
    for (const { sheetId, sheetTab } of targets) {
      const key = `${sheetId || 'default'}/${sheetTab || 'default'}`;
      try {
        await checkReplies(sheetId, sheetTab);
        await checkBounces(sheetId, sheetTab, lookbackDays);
        results[key] = 'ok';
      } catch (err: any) {
        results[key] = `error: ${err.message}`;
      }
    }
    res.json({ ok: true, lookbackDays, results });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/pipeline/migrate-tracking — one-shot: shift tracking data from wrong
// columns (W–AE, old wrong schema) to correct columns (R–Z, actual sheet schema).
router.post('/migrate-tracking', async (req: Request, res: Response) => {
  try {
    const { migrateTrackingColumns } = await import('../../../pipeline/src/sheets');
    const sheetId  = (req.body?.sheetId  as string | undefined) || undefined;
    const sheetTab = (req.body?.sheetTab as string | undefined) || undefined;
    const result = await migrateTrackingColumns(sheetId, sheetTab);
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/pipeline/clean-legacy — DISABLED (schema now correctly maps T/U to sentAt/messageId)
router.post('/clean-legacy', (_req: Request, res: Response) => {
  res.json({ ok: false, error: 'clean-legacy is disabled — schema has been corrected, T/U contain valid tracking data.' });
});

// POST /api/pipeline/init-tracking-headers — write column headers for Y-AG if missing
router.post('/init-tracking-headers', async (req: Request, res: Response) => {
  try {
    const { initTrackingHeaders } = await import('../../../pipeline/src/sheets');
    const sheetId = (req.body?.sheetId as string) || undefined;
    const sheetTab = (req.body?.sheetTab as string) || undefined;
    const result = await initTrackingHeaders(sheetId, sheetTab);
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/pipeline/backfill-sent — scan Gmail sent folder, write threadId/messageId/sentAt back to sheet for "Contacted=Yes" rows
router.post('/backfill-sent', async (req: Request, res: Response) => {
  try {
    const { backfillSentEmails } = await import('../../../pipeline/src/sheets');
    const { setSenders } = await import('../../../pipeline/src/gmail');
    const senders = readSenders().filter(s => !!s.refreshToken);
    if (senders.length === 0) {
      res.status(400).json({ ok: false, error: 'No connected senders with refresh tokens' });
      return;
    }
    setSenders(senders.map(s => ({ ...s })));

    const sheetId = (req.body?.sheetId as string) || undefined;
    const sheetTab = (req.body?.sheetTab as string) || undefined;
    const lookbackDays: number = parseInt(req.body?.lookbackDays) || 90;

    const result = await backfillSentEmails(senders, lookbackDays, sheetId, sheetTab);
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
