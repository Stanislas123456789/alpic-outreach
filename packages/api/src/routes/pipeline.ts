import { Router, Request, Response } from 'express';
import { readSenders, syncSentCounts } from '../senders';

const router = Router();

let pipelineRunning = false;
let lastRunAt: string | null = null;
let lastRunResult: 'success' | 'error' | null = null;
let lastRunError: string | null = null;

// ─── Progress tracking ────────────────────────────────────────────────────────

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

let progressLog: ProgressEvent[] = [];
let progressTotal = 0;

function pushProgress(event: ProgressEvent) {
  progressLog.push(event);
}

// POST /api/pipeline/run — trigger a send batch immediately
// Body: { excludeIds?: string[], sheetId?: string, tab?: string, emailOverrides?: Record<string, { subject: string, body: string }> }
router.post('/run', async (req: Request, res: Response) => {
  if (pipelineRunning) {
    res.status(409).json({
      error: 'Pipeline already running',
      lastRunAt,
    });
    return;
  }

  const senders = readSenders().filter(s => !!s.refreshToken);
  if (senders.length === 0) {
    res.status(400).json({
      error: 'No senders connected. Connect a Gmail account first.',
    });
    return;
  }

  const excludeIds: string[] = req.body?.excludeIds || [];
  const sheetId: string | undefined = req.body?.sheetId;
  const sheetTab: string | undefined = req.body?.tab;
  const emailOverrides: Record<string, { subject: string; body: string }> = req.body?.emailOverrides || {};

  // Reset progress log
  progressLog = [];
  progressTotal = 0;

  // Respond immediately — pipeline runs async
  res.json({
    ok: true,
    message: 'Pipeline batch started',
    senderCount: senders.length,
    excluded: excludeIds.length,
  });

  pipelineRunning = true;
  lastRunAt = new Date().toISOString();

  try {
    const { runPipeline } = await import('../../../pipeline/src/index');
    const { setSenders, getSenders } = await import('../../../pipeline/src/gmail');

    setSenders(senders.map(s => ({ ...s })));
    await runPipeline({
      excludeIds,
      sheetId,
      sheetTab,
      emailOverrides,
      onProgress: pushProgress,
    });

    syncSentCounts(getSenders());

    lastRunResult = 'success';
    lastRunError = null;
    console.log('[api] Pipeline batch complete');
  } catch (err: any) {
    lastRunResult = 'error';
    lastRunError = err.message;
    console.error('[api] Pipeline batch error:', err.message);
  } finally {
    pipelineRunning = false;
    pushProgress({ type: 'done', timestamp: new Date().toISOString() });
  }
});

// GET /api/pipeline/progress — poll current send progress
router.get('/progress', (_req: Request, res: Response) => {
  res.json({
    running: pipelineRunning,
    total: progressTotal,
    log: progressLog,
  });
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

// GET /api/pipeline/status — current pipeline state + per-sender stats
router.get('/status', (_req: Request, res: Response) => {
  const senders = readSenders();
  res.json({
    running: pipelineRunning,
    lastRunAt,
    lastRunResult,
    lastRunError,
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
