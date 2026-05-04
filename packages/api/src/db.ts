// ============================================
// POSTGRES PERSISTENCE LAYER
// Campaign history + daily send counters
// ============================================
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false,
  max: 5,
});

// ─── Schema init ─────────────────────────────────────────────────────────────

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT,
      sheet_id TEXT NOT NULL,
      sheet_tab TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      sent INTEGER DEFAULT 0,
      total INTEGER DEFAULT 0,
      error TEXT,
      template_id TEXT,
      follow_up JSONB,
      follow_up2 JSONB,
      follow_up_unsub BOOLEAN DEFAULT true,
      unsub_enabled BOOLEAN DEFAULT true,
      send_window JSONB,
      week_schedule JSONB,
      started_at TIMESTAMPTZ,
      scheduled_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS campaign_events (
      id SERIAL PRIMARY KEY,
      campaign_id TEXT REFERENCES campaigns(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      contact_id TEXT,
      email TEXT,
      first_name TEXT,
      company TEXT,
      via TEXT,
      error TEXT,
      idx INTEGER,
      total INTEGER,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_events_campaign ON campaign_events(campaign_id);

    CREATE TABLE IF NOT EXISTS sender_daily_stats (
      sender_email TEXT NOT NULL,
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      sent_count INTEGER DEFAULT 0,
      PRIMARY KEY (sender_email, date)
    );

    CREATE TABLE IF NOT EXISTS sheet_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sheet_id TEXT NOT NULL,
      sheet_tab TEXT NOT NULL,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  // Migrations for existing tables
  await pool.query(`
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS send_window JSONB;
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS week_schedule JSONB;
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sender_email TEXT;
  `).catch(() => {
    // Column may already exist or table may not exist yet — safe to ignore
  });

  console.log('[db] Postgres tables ready');
}

// ─── Campaign CRUD ───────────────────────────────────────────────────────────

export interface DbCampaign {
  id: string;
  name?: string;
  sheetId: string;
  sheetTab: string;
  status: string;
  sent: number;
  total: number;
  error?: string;
  templateId?: string;
  followUp?: any;
  followUp2?: any;
  followUpUnsubscribeEnabled?: boolean;
  unsubscribeEnabled?: boolean;
  sendWindow?: any;
  weekSchedule?: any;
  senderEmail?: string;
  startedAt: string | null;
  scheduledAt: string | null;
  completedAt?: string | null;
  createdAt?: string;
}

export async function saveCampaign(c: DbCampaign): Promise<void> {
  await pool.query(`
    INSERT INTO campaigns (id, name, sheet_id, sheet_tab, status, sent, total, error, template_id,
      follow_up, follow_up2, follow_up_unsub, unsub_enabled, send_window, week_schedule,
      sender_email, started_at, scheduled_at, completed_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      sent = EXCLUDED.sent,
      total = EXCLUDED.total,
      error = EXCLUDED.error,
      started_at = EXCLUDED.started_at,
      completed_at = EXCLUDED.completed_at,
      sender_email = COALESCE(EXCLUDED.sender_email, campaigns.sender_email)
  `, [
    c.id, c.name || null, c.sheetId, c.sheetTab, c.status, c.sent, c.total,
    c.error || null, c.templateId || null,
    c.followUp ? JSON.stringify(c.followUp) : null,
    c.followUp2 ? JSON.stringify(c.followUp2) : null,
    c.followUpUnsubscribeEnabled ?? true,
    c.unsubscribeEnabled ?? true,
    c.sendWindow ? JSON.stringify(c.sendWindow) : null,
    c.weekSchedule ? JSON.stringify(c.weekSchedule) : null,
    c.senderEmail || null,
    c.startedAt || null, c.scheduledAt || null, c.completedAt || null,
  ]);
}

export async function getCampaigns(limit = 50): Promise<DbCampaign[]> {
  const { rows } = await pool.query(`
    SELECT * FROM campaigns
    ORDER BY COALESCE(started_at, scheduled_at, created_at) DESC
    LIMIT $1
  `, [limit]);
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    sheetId: r.sheet_id,
    sheetTab: r.sheet_tab,
    status: r.status,
    sent: r.sent,
    total: r.total,
    error: r.error,
    templateId: r.template_id,
    followUp: r.follow_up,
    followUp2: r.follow_up2,
    followUpUnsubscribeEnabled: r.follow_up_unsub,
    unsubscribeEnabled: r.unsub_enabled,
    sendWindow: r.send_window,
    weekSchedule: r.week_schedule,
    senderEmail: r.sender_email,
    startedAt: r.started_at?.toISOString() || null,
    scheduledAt: r.scheduled_at?.toISOString() || null,
    completedAt: r.completed_at?.toISOString() || null,
    createdAt: r.created_at?.toISOString(),
  }));
}

export async function getCampaign(id: string): Promise<DbCampaign | null> {
  const results = await getCampaigns(100);
  return results.find(c => c.id === id) || null;
}

export async function updateCampaignStatus(id: string, status: string, extra?: { sent?: number; total?: number; error?: string; startedAt?: string; completedAt?: string }): Promise<void> {
  const sets = ['status = $2'];
  const vals: any[] = [id, status];
  let i = 3;
  if (extra?.sent !== undefined) { sets.push(`sent = $${i}`); vals.push(extra.sent); i++; }
  if (extra?.total !== undefined) { sets.push(`total = $${i}`); vals.push(extra.total); i++; }
  if (extra?.error !== undefined) { sets.push(`error = $${i}`); vals.push(extra.error); i++; }
  if (extra?.startedAt !== undefined) { sets.push(`started_at = $${i}`); vals.push(extra.startedAt); i++; }
  if (extra?.completedAt !== undefined) { sets.push(`completed_at = $${i}`); vals.push(extra.completedAt); i++; }
  await pool.query(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = $1`, vals);
}

// ─── Campaign events ─────────────────────────────────────────────────────────

export async function addCampaignEvent(campaignId: string, event: {
  type: string; contactId?: string; email?: string; firstName?: string;
  company?: string; via?: string; error?: string; idx?: number; total?: number;
}): Promise<void> {
  await pool.query(`
    INSERT INTO campaign_events (campaign_id, type, contact_id, email, first_name, company, via, error, idx, total)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
  `, [campaignId, event.type, event.contactId, event.email, event.firstName, event.company, event.via, event.error, event.idx, event.total]);
}

export async function getCampaignEvents(campaignId: string): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT type, contact_id, email, first_name, company, via, error, idx, total, created_at FROM campaign_events WHERE campaign_id = $1 ORDER BY id`,
    [campaignId]
  );
  return rows.map(r => ({
    type: r.type, contactId: r.contact_id, email: r.email, firstName: r.first_name,
    company: r.company, via: r.via, error: r.error, index: r.idx, total: r.total,
    timestamp: r.created_at?.toISOString(),
  }));
}

// ─── Unique sheets (for cron) ────────────────────────────────────────────────

export async function getUniqueCampaignSheets(): Promise<{ sheetId: string; sheetTab: string }[]> {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (sheet_id, sheet_tab) sheet_id, sheet_tab
    FROM campaigns WHERE status IN ('done', 'running')
    ORDER BY sheet_id, sheet_tab
  `);
  return rows.map(r => ({ sheetId: r.sheet_id, sheetTab: r.sheet_tab }));
}

export async function getFollowUpConfigs(): Promise<{ sheetId: string; sheetTab: string; followUp: any; followUp2?: any; unsubscribeEnabled: boolean }[]> {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (sheet_id, sheet_tab) sheet_id, sheet_tab, follow_up, follow_up2, follow_up_unsub
    FROM campaigns
    WHERE follow_up IS NOT NULL AND (follow_up->>'enabled')::boolean = true
    ORDER BY sheet_id, sheet_tab, COALESCE(started_at, scheduled_at) DESC
  `);
  return rows.map(r => ({
    sheetId: r.sheet_id,
    sheetTab: r.sheet_tab,
    followUp: r.follow_up,
    followUp2: r.follow_up2,
    unsubscribeEnabled: r.follow_up_unsub !== false,
  }));
}

// ─── Sender daily stats ──────────────────────────────────────────────────────

export async function getSenderDailyCount(email: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT sent_count FROM sender_daily_stats WHERE sender_email = $1 AND date = CURRENT_DATE`,
    [email]
  );
  return rows[0]?.sent_count || 0;
}

export async function incrementSenderDailyCount(email: string, count = 1): Promise<void> {
  await pool.query(`
    INSERT INTO sender_daily_stats (sender_email, date, sent_count)
    VALUES ($1, CURRENT_DATE, $2)
    ON CONFLICT (sender_email, date) DO UPDATE SET sent_count = sender_daily_stats.sent_count + $2
  `, [email, count]);
}

export async function getAllSenderDailyCounts(): Promise<Record<string, number>> {
  const { rows } = await pool.query(
    `SELECT sender_email, sent_count FROM sender_daily_stats WHERE date = CURRENT_DATE`
  );
  const result: Record<string, number> = {};
  for (const r of rows) result[r.sender_email] = r.sent_count;
  return result;
}

export function isDbAvailable(): boolean {
  return !!process.env.DATABASE_URL;
}

// ─── Sheet sources (shared across team) ─────────────────────────────────────

export interface DbSheetSource {
  id: string;
  name: string;
  sheetId: string;
  sheetTab: string;
  createdBy?: string;
  createdAt?: string;
}

export async function listSources(): Promise<DbSheetSource[]> {
  const { rows } = await pool.query(
    `SELECT id, name, sheet_id, sheet_tab, created_by, created_at FROM sheet_sources ORDER BY created_at`
  );
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    sheetId: r.sheet_id,
    sheetTab: r.sheet_tab,
    createdBy: r.created_by,
    createdAt: r.created_at?.toISOString(),
  }));
}

export async function upsertSource(s: DbSheetSource): Promise<void> {
  await pool.query(`
    INSERT INTO sheet_sources (id, name, sheet_id, sheet_tab, created_by)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      sheet_id = EXCLUDED.sheet_id,
      sheet_tab = EXCLUDED.sheet_tab
  `, [s.id, s.name, s.sheetId, s.sheetTab, s.createdBy || null]);
}

export async function deleteSource(id: string): Promise<void> {
  await pool.query(`DELETE FROM sheet_sources WHERE id = $1`, [id]);
}
