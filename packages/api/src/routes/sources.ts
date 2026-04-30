import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { listSources, upsertSource, deleteSource, isDbAvailable } from '../db';

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
  const source = {
    id: randomUUID(),
    name,
    sheetId,
    sheetTab,
    createdBy: (req.headers['x-auth-email'] as string) || undefined,
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
