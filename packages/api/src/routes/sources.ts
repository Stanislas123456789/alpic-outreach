import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { listSources, upsertSource, deleteSource, isDbAvailable } from '../db';
import { readSenders } from '../senders';

const router = Router();

// GET /api/sources — list all shared sheet sources
router.get('/', async (_req: Request, res: Response) => {
  if (!isDbAvailable()) {
    res.json([]);
    return;
  }
  try {
    const sources = await listSources();
    res.json(sources);
  } catch (err: any) {
    console.error('[sources] Failed to list:', err.message);
    res.status(500).json({ error: 'Failed to load sources' });
  }
});

// POST /api/sources — add a new shared source
router.post('/', async (req: Request, res: Response) => {
  if (!isDbAvailable()) {
    res.status(503).json({ error: 'Database not available' });
    return;
  }
  const { name, sheetId, sheetTab } = req.body;
  if (!name || !sheetId || !sheetTab) {
    res.status(400).json({ error: 'name, sheetId, and sheetTab are required' });
    return;
  }
  // Verify write access before saving — catches permission issues immediately
  // instead of silently breaking tracking later.
  const userEmail = req.headers['x-auth-email'] as string | undefined;
  const senders = readSenders().filter(s => !!s.refreshToken);
  const preferred = (userEmail && senders.find(s => s.email === userEmail)) || senders[0];
  if (preferred) {
    try {
      const { setUserSheetsToken } = await import('../../../pipeline/src/sheets');
      setUserSheetsToken(preferred.refreshToken);
      const { google } = await import('googleapis');
      const CLIENT_ID = process.env.GMAIL_CLIENT_ID!;
      const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET!;
      const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
      oauth2.setCredentials({ refresh_token: preferred.refreshToken });
      const sheets = google.sheets({ version: 'v4', auth: oauth2 });
      // Read test — verify we can access the sheet
      await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `'${sheetTab.replace(/'/g, "\\'")}'!A1:A1`,
      });
    } catch (err: any) {
      const msg = err.message || '';
      if (/403|forbidden|permission|access/i.test(msg)) {
        res.status(403).json({
          error: `Cannot access this sheet. Make sure "${preferred.email}" has edit access to the Google Sheet, then try again.`,
        });
        return;
      }
      if (/404|not found/i.test(msg)) {
        res.status(404).json({ error: 'Sheet not found. Check the Sheet ID and tab name.' });
        return;
      }
      // Non-permission error — log but don't block
      console.warn(`[sources] Sheet access check warning: ${msg}`);
    }
  }

  const source = {
    id: randomUUID(),
    name,
    sheetId,
    sheetTab,
    createdBy: userEmail || undefined,
  };
  try {
    await upsertSource(source);
    res.status(201).json(source);
  } catch (err: any) {
    console.error('[sources] Failed to create:', err.message);
    res.status(500).json({ error: 'Failed to create source' });
  }
});

// PUT /api/sources/:id — update an existing source
router.put('/:id', async (req: Request, res: Response) => {
  if (!isDbAvailable()) {
    res.status(503).json({ error: 'Database not available' });
    return;
  }
  const { name, sheetId, sheetTab } = req.body;
  if (!name || !sheetId || !sheetTab) {
    res.status(400).json({ error: 'name, sheetId, and sheetTab are required' });
    return;
  }
  try {
    await upsertSource({ id: req.params.id, name, sheetId, sheetTab });
    res.json({ id: req.params.id, name, sheetId, sheetTab });
  } catch (err: any) {
    console.error('[sources] Failed to update:', err.message);
    res.status(500).json({ error: 'Failed to update source' });
  }
});

// DELETE /api/sources/:id — delete a source (prevent deleting last one)
router.delete('/:id', async (req: Request, res: Response) => {
  if (!isDbAvailable()) {
    res.status(503).json({ error: 'Database not available' });
    return;
  }
  try {
    const sources = await listSources();
    if (sources.length <= 1) {
      res.status(400).json({ error: 'Cannot delete the last source' });
      return;
    }
    await deleteSource(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[sources] Failed to delete:', err.message);
    res.status(500).json({ error: 'Failed to delete source' });
  }
});

export default router;
