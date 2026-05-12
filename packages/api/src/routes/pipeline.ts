import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { readSenders, syncSentCounts } from '../senders';
import * as db from '../db';

const router = Router();

// ─── Tracking pixel health check ─────────────────────────────────────────────
// Verifies the tracking pixel URL is reachable and returns a valid image.
// Called before campaign launch to catch dead domains early.

async function checkTrackingPixelHealth(): Promise<{ ok: boolean; url: string; error?: string }> {
  const base = (process.env.TRACKING_BASE_URL || '').replace(/\/$/, '');
  if (!base) return { ok: false, url: '', error: 'TRACKING_BASE_URL not set' };

  const testUrl = `${base}/pixel/health-check?row=0`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(testUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) return { ok: true, url: base };
    return { ok: false, url: base, error: `HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, url: base, error: err.code === 'ENOTFOUND' ? 'DNS not found' : err.message };
  }
}

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
  status: 'scheduled' | 'running' | 'done' | 'error' | 'cancelled' | 'active';
  sent: number;
  total: number;
  log: ProgressEvent[];
  error?: string;
  followUp?: CampaignFollowUp;
  followUp2?: CampaignFollowUp;
  followUpUnsubscribeEnabled?: boolean;
  sendWindow?: { enabled: boolean; startHour: number; endHour: number };
  weekSchedule?: { activeDays: boolean[]; distributionMode: string; customWeights?: number[] };
  ccEmail?: string;
  listUnsubscribe?: boolean;
  plainTextFallback?: boolean;
  senderEmail?: string;
  speedMode?: string;
  draftMode?: boolean;
  unsubscribeEnabled?: boolean;
  emailOverrides?: Record<string, { subject: string; body: string }>;
  excludeIds?: string[];
  maxEmails?: number;
  daysSent?: number;               // how many days have sent so far
  scheduledTimer?: ReturnType<typeof setTimeout>;
}

// ─── Persistence (Postgres + in-memory cache) ───────────────────────────────

const campaigns = new Map<string, Campaign>();

// Load campaigns from Postgres into memory on startup
export async function loadCampaignsFromDb(): Promise<void> {
  if (!db.isDbAvailable()) {
    console.log('[campaigns] No DATABASE_URL — running without persistent campaign storage');
    return;
  }
  try {
    const rows = await db.getCampaigns(100);
    for (const r of rows) {
      // Any campaign that was "running" at shutdown is now "error"
      const status = r.status === 'running' ? 'error' : r.status;
      campaigns.set(r.id, {
        id: r.id,
        name: r.name,
        sheetId: r.sheetId,
        sheetTab: r.sheetTab,
        status: status as Campaign['status'],
        sent: r.sent,
        total: r.total,
        error: r.error,
        followUp: r.followUp,
        followUp2: r.followUp2,
        followUpUnsubscribeEnabled: r.followUpUnsubscribeEnabled,
        sendWindow: r.sendWindow,
        weekSchedule: r.weekSchedule,
        senderEmail: r.senderEmail,
        startedAt: r.startedAt,
        scheduledAt: r.scheduledAt,
        log: [],
      });
      // Fix stuck "running" campaigns in Postgres too
      if (r.status === 'running') {
        db.updateCampaignStatus(r.id, 'error', { error: 'Server restarted during execution' }).catch(() => {});
      }
      // SAFETY: Never auto-execute campaigns on server boot. All scheduled/active
      // campaigns require manual re-launch from the dashboard. This prevents
      // ghost sends when the server restarts or migrates to a new environment.
      if (status === 'scheduled' || status === 'active') {
        const c = campaigns.get(r.id)!;
        const msg = `Server restarted — campaign paused. Re-launch manually from the dashboard.`;
        c.status = 'error' as Campaign['status'];
        c.error = msg;
        db.updateCampaignStatus(r.id, 'error', { error: msg }).catch(() => {});
        console.log(`[campaigns] Paused ${status} campaign ${r.id} — manual re-launch required`);
      }
    }
    console.log(`[campaigns] Loaded ${campaigns.size} campaigns from Postgres`);
  } catch (err) {
    console.error('[campaigns] Failed to load from Postgres:', err);
  }
}

function saveCampaignToDb(c: Campaign): void {
  if (!db.isDbAvailable()) return;
  db.saveCampaign({
    id: c.id,
    name: c.name,
    sheetId: c.sheetId,
    sheetTab: c.sheetTab,
    status: c.status,
    sent: c.sent,
    total: c.total,
    error: c.error,
    followUp: c.followUp,
    followUp2: c.followUp2,
    followUpUnsubscribeEnabled: c.followUpUnsubscribeEnabled,
    sendWindow: c.sendWindow,
    weekSchedule: c.weekSchedule,
    senderEmail: c.senderEmail,
    startedAt: c.startedAt,
    scheduledAt: c.scheduledAt,
    completedAt: c.status === 'done' || c.status === 'error' ? new Date().toISOString() : null,
  }).catch(err => console.error('[campaigns] Postgres save error:', err));
}

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

// Returns follow-up configs — reads from in-memory cache (populated from Postgres on startup)
export function getFollowUpConfigs(): { sheetId: string; sheetTab: string; followUp: CampaignFollowUp; followUp2?: CampaignFollowUp; unsubscribeEnabled: boolean }[] {
  const seen = new Set<string>();
  const result: { sheetId: string; sheetTab: string; followUp: CampaignFollowUp; followUp2?: CampaignFollowUp; unsubscribeEnabled: boolean }[] = [];
  const sorted = Array.from(campaigns.values())
    .filter(c => c.followUp?.enabled)
    .sort((a, b) => (b.startedAt || b.scheduledAt || '').localeCompare(a.startedAt || a.scheduledAt || ''));
  for (const c of sorted) {
    const key = `${c.sheetId}::${c.sheetTab}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ sheetId: c.sheetId, sheetTab: c.sheetTab, followUp: c.followUp!, followUp2: c.followUp2, unsubscribeEnabled: c.followUpUnsubscribeEnabled !== false });
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
  unsubscribeEnabled?: boolean,
  sendWindow?: { enabled: boolean; startHour: number; endHour: number },
  weekSchedule?: { activeDays: boolean[]; distributionMode: string; customWeights?: number[] },
  ccEmail?: string,
  listUnsubscribe?: boolean,
  plainTextFallback?: boolean,
) {
  campaign.status = 'running';
  campaign.startedAt = new Date().toISOString();
  saveCampaignToDb(campaign);

  const { minDelay, maxDelay } = speedToDelays(speedMode);

  try {
    const { runPipeline } = await import('../../../pipeline/src/index');
    const { setSenders, getSenders } = await import('../../../pipeline/src/gmail');
    const { setUserSheetsToken } = await import('../../../pipeline/src/sheets');

    const senders = readSenders().filter(s => !!s.refreshToken);
    // Always inject ALL senders so the global pool stays complete — sender
    // isolation is enforced per-campaign via the senderEmail param passed to
    // runPipeline → pickSender, not by filtering the global list (which is
    // racy: the follow-up cron can overwrite it mid-campaign).
    setSenders(senders.map(s => ({ ...s })));
    const preferredSender = senderEmail ? senders.find(s => s.email === senderEmail) : senders[0];
    const sheetsToken = (preferredSender || senders[0])?.refreshToken ?? null;
    setUserSheetsToken(sheetsToken);

    await runPipeline({
      excludeIds,
      sheetId: campaign.sheetId,
      sheetTab: campaign.sheetTab,
      emailOverrides,
      maxEmails,
      minDelay,
      maxDelay,
      draftMode,
      unsubscribeEnabled,
      senderEmail,
      sendWindow: sendWindow || campaign.sendWindow,
      weekSchedule: weekSchedule || campaign.weekSchedule,
      ccEmail: ccEmail ?? campaign.ccEmail,
      listUnsubscribe: listUnsubscribe ?? campaign.listUnsubscribe ?? true,
      plainTextFallback: plainTextFallback ?? campaign.plainTextFallback ?? true,
      onProgress: (event: ProgressEvent) => {
        campaign.log.push(event);
        if (event.type === 'start' && event.total != null) {
          campaign.total = event.total;
        }
        if (event.type === 'sent') {
          campaign.sent += 1;
          // Persist send count to Postgres for the sender
          if (event.via) db.incrementSenderDailyCount(event.via).catch(() => {});
        }
        // Persist event to Postgres
        db.addCampaignEvent(campaign.id, {
          type: event.type, contactId: event.contactId, email: event.email,
          firstName: event.firstName, company: event.company, via: event.via,
          error: event.error, idx: event.index, total: event.total,
        }).catch(() => {});
      },
    });

    syncSentCounts(getSenders());
    campaign.daysSent = (campaign.daysSent || 0) + 1;

    // Multi-day campaign: if weekSchedule has more active days ahead and there
    // are likely remaining contacts, set status to "active" and schedule next day
    const isMultiDay = campaign.weekSchedule?.activeDays?.filter(Boolean).length! > 1;
    if (isMultiDay) {
      const { getPendingContacts } = await import('../../../pipeline/src/sheets');
      const remaining = await getPendingContacts(1, campaign.sheetId, campaign.sheetTab);
      if (remaining.length > 0) {
        // Find next active day
        const today = new Date().getDay();
        const days = campaign.weekSchedule!.activeDays;
        let nextDayOffset = 0;
        for (let d = 1; d <= 7; d++) {
          const dayIdx = (today + d) % 7;
          if (days[dayIdx]) { nextDayOffset = d; break; }
        }
        if (nextDayOffset > 0) {
          const nextRun = new Date();
          nextRun.setDate(nextRun.getDate() + nextDayOffset);
          nextRun.setHours(campaign.sendWindow?.startHour || 9, 0, 0, 0);
          campaign.status = 'active';
          campaign.scheduledAt = nextRun.toISOString();
          campaign.scheduledTimer = setTimeout(() => {
            executeCampaign(campaign, [], campaign.emailOverrides || {},
              campaign.maxEmails, campaign.speedMode, campaign.draftMode,
              campaign.senderEmail, campaign.unsubscribeEnabled,
              campaign.sendWindow, campaign.weekSchedule, campaign.ccEmail,
              campaign.listUnsubscribe, campaign.plainTextFallback);
          }, nextRun.getTime() - Date.now());
          console.log(`[api] Campaign ${campaign.id} day ${campaign.daysSent} complete — next run ${nextRun.toISOString()} (${remaining.length} contacts remaining)`);
          campaign.log.push({ type: 'done', timestamp: new Date().toISOString() });
          saveCampaignToDb(campaign);
          return; // Don't fall through to "done" status
        }
      }
    }

    campaign.status = 'done';
    console.log(`[api] Campaign ${campaign.id} complete (${campaign.daysSent || 1} day${(campaign.daysSent || 1) > 1 ? 's' : ''})`);
  } catch (err: any) {
    campaign.status = 'error';
    campaign.error = err.message;
    console.error(`[api] Campaign ${campaign.id} error:`, err.message);
  } finally {
    if (campaign.status !== 'active') {
      campaign.log.push({ type: 'done', timestamp: new Date().toISOString() });
    }
    saveCampaignToDb(campaign);
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
  const sheetId: string = req.body?.sheetId || process.env.GOOGLE_SHEET_ID || '';
  const sheetTab: string = req.body?.tab || process.env.GOOGLE_SHEET_TAB || 'Master Table';
  console.log(`[campaign] Sheet: ${sheetId} / Tab: ${sheetTab} (from body: ${!!req.body?.sheetId})`);
  const scheduledAt: string | undefined = req.body?.scheduledAt;
  const maxEmails: number | undefined = req.body?.maxEmails ? Number(req.body.maxEmails) : undefined;
  const speedMode: string | undefined = req.body?.speedMode;
  const draftMode: boolean = req.body?.draftMode === true;
  // senderEmail restricts sending to a single sender account — prevents cross-user email mixing.
  // ONLY use the authenticated user's email from the auth header. Never trust the request body.
  const senderEmail: string | undefined = req.headers['x-auth-email'] as string | undefined;
  const unsubscribeEnabled: boolean = req.body?.unsubscribeEnabled !== false; // default true
  const followUpUnsubscribeEnabled: boolean = req.body?.followUpUnsubscribeEnabled !== false; // default true
  const sendWindow = req.body?.sendWindow || undefined;
  const weekSchedule = req.body?.weekSchedule || undefined;
  // Deliverability options (all default to sensible spam-safe values)
  const ccEmail: string | undefined = req.body?.ccEmail || undefined;  // no CC by default
  const listUnsubscribe: boolean = req.body?.listUnsubscribe !== false;  // default true
  const plainTextFallback: boolean = req.body?.plainTextFallback !== false;  // default true

  // Concurrent campaigns are allowed — sender isolation is enforced per-campaign
  // via pickSender(senderEmail), and each contact is marked "sending" in the sheet
  // before the email goes out, preventing double-sends between concurrent campaigns.

  // Pre-flight: verify tracking pixel is reachable
  const trackingHealth = await checkTrackingPixelHealth();
  if (!trackingHealth.ok) {
    console.warn(`[campaign] ⚠️ Tracking pixel UNREACHABLE: ${trackingHealth.url} — ${trackingHealth.error}`);
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
  const followUp2Raw = req.body?.followUp2;
  const followUp2: CampaignFollowUp | undefined = followUp2Raw?.enabled ? {
    enabled: true,
    delayDays: Number(followUp2Raw.delayDays) || 4,
    subjectEn: followUp2Raw.subjectEn || '',
    subjectFr: followUp2Raw.subjectFr || '',
    bodyEn: followUp2Raw.bodyEn || '',
    bodyFr: followUp2Raw.bodyFr || '',
  } : undefined;
  const emailOverrides: Record<string, { subject: string; body: string }> = req.body?.emailOverrides || {};
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
    followUp2,
    followUpUnsubscribeEnabled,
    sendWindow,
    weekSchedule,
    ccEmail,
    listUnsubscribe,
    plainTextFallback,
    senderEmail,
    speedMode,
    draftMode,
    unsubscribeEnabled,
    emailOverrides,
    excludeIds,
    maxEmails,
    daysSent: 0,
  };

  campaigns.set(campaignId, campaign);
  saveCampaignToDb(campaign);

  const now = new Date();
  const scheduleTime = scheduledAt ? new Date(scheduledAt) : null;
  const isInFuture = scheduleTime && scheduleTime > now;

  if (isInFuture) {
    const delay = scheduleTime.getTime() - now.getTime();
    campaign.scheduledTimer = setTimeout(() => {
      executeCampaign(campaign, excludeIds, emailOverrides, maxEmails, speedMode, draftMode, senderEmail, unsubscribeEnabled, sendWindow, weekSchedule, ccEmail, listUnsubscribe, plainTextFallback);
    }, delay);

    res.json({
      ok: true,
      campaignId,
      message: `Campaign scheduled for ${scheduledAt}`,
      trackingPixel: trackingHealth.ok ? 'ok' : `WARNING: open tracking broken — ${trackingHealth.error} (${trackingHealth.url})`,
    });
  } else {
    // Run immediately
    campaign.scheduledAt = null;
    res.json({
      ok: true,
      campaignId,
      message: draftMode ? 'Draft campaign started' : 'Pipeline batch started',
      senderCount: senders.length,
      excluded: excludeIds.length,
      draftMode,
      trackingPixel: trackingHealth.ok ? 'ok' : `WARNING: open tracking broken — ${trackingHealth.error} (${trackingHealth.url})`,
    });

    // Run async after responding
    executeCampaign(campaign, excludeIds, emailOverrides, maxEmails, speedMode, draftMode, senderEmail, unsubscribeEnabled, sendWindow, weekSchedule, ccEmail, listUnsubscribe, plainTextFallback);
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
    log: campaign.log.slice(-500), // Cap to last 500 events to prevent response bloat
    campaignId: campaign.id,
    sent: campaign.sent,
    status: campaign.status,
  });
});

// GET /api/pipeline/campaigns — list all campaigns with sent contact emails
router.get('/campaigns', async (_req: Request, res: Response) => {
  const list = Array.from(campaigns.values())
    .map(({ scheduledTimer, log, ...c }) => c)  // strip internal timer + large log array
    .sort((a, b) => (b.startedAt || b.scheduledAt || '').localeCompare(a.startedAt || a.scheduledAt || ''));

  // Enrich with contact emails from Postgres for per-campaign performance tracking
  if (db.isDbAvailable()) {
    try {
      const enriched = await Promise.all(list.map(async (c) => {
        const events = await db.getCampaignEvents(c.id);
        const sentEmails = events.filter(e => e.type === 'sent').map(e => e.email).filter(Boolean);
        // Backfill senderEmail from events for old campaigns that didn't store it
        const senderEmail = c.senderEmail || events.find(e => e.type === 'sent' && e.via)?.via || undefined;
        return { ...c, senderEmail, sentEmails };
      }));
      res.json(enriched);
      return;
    } catch {}
  }
  res.json(list);
});

// DELETE /api/pipeline/campaigns/:id — cancel a scheduled campaign
router.delete('/campaigns/:id', (req: Request, res: Response) => {
  const c = campaigns.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campaign not found' });
  if (c.status !== 'scheduled') return res.status(409).json({ error: 'Can only cancel scheduled campaigns' });
  clearTimeout(c.scheduledTimer);
  c.status = 'cancelled';
  saveCampaignToDb(c);
  res.json({ ok: true });
});

// GET /api/pipeline/campaigns/:id — get single campaign with full log
router.get('/campaigns/:id', async (req: Request, res: Response) => {
  const c = campaigns.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campaign not found' });
  const { scheduledTimer, ...rest } = c;
  // Load events from Postgres if available and in-memory log is empty
  if (rest.log.length === 0 && db.isDbAvailable()) {
    try { rest.log = await db.getCampaignEvents(rest.id); } catch {}
  }
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
router.get('/status', async (_req: Request, res: Response) => {
  const senders = readSenders();
  const anyRunning = Array.from(campaigns.values()).some(c => c.status === 'running');
  const last = getLastCampaign();
  const trackingHealth = await checkTrackingPixelHealth();

  res.json({
    running: anyRunning,
    lastRunAt: last?.startedAt || null,
    lastRunResult: last ? (last.status === 'done' ? 'success' : last.status === 'error' ? 'error' : null) : null,
    lastRunError: last?.error || null,
    trackingPixel: {
      ok: trackingHealth.ok,
      url: trackingHealth.url,
      error: trackingHealth.error || null,
    },
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
