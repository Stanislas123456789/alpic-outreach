// ============================================
// SENDER TOKEN STORE
// Primary: Postgres (survives Railway restarts)
// Fallback: JSON file + env vars
// ============================================
import fs from 'fs';
import path from 'path';
import { isDbAvailable, dbGetSenders, dbUpsertSender, dbUpdateSenderToken, dbDeleteSender } from './db';

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../data');
const DATA_PATH = path.join(DATA_DIR, 'senders.json');

export interface StoredSender {
  email: string;
  name: string;
  refreshToken: string;
  dailyLimit: number;
  sentToday: number;
  lastReset: string; // YYYY-MM-DD
}

function ensureDataFile(): void {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_PATH)) fs.writeFileSync(DATA_PATH, '[]', 'utf-8');
}

// ─── Env-var fallback senders ─────────────────────────────────────────────────
// Railway containers have an ephemeral filesystem — senders.json is lost on every
// restart.  Set SENDER_1_EMAIL + SENDER_1_REFRESH_TOKEN (and optionally
// SENDER_1_NAME, SENDER_1_DAILY_LIMIT) as Railway env vars to ensure at least
// one sender is always available without needing to re-run the OAuth flow.
// Supports up to 5 senders (SENDER_1_…  through  SENDER_5_…).
function getEnvFallbackSenders(): StoredSender[] {
  const today = new Date().toISOString().slice(0, 10);
  const result: StoredSender[] = [];
  for (let i = 1; i <= 5; i++) {
    const email = process.env[`SENDER_${i}_EMAIL`];
    const refreshToken = process.env[`SENDER_${i}_REFRESH_TOKEN`];
    if (email && refreshToken) {
      result.push({
        email,
        name: process.env[`SENDER_${i}_NAME`] || email,
        refreshToken,
        dailyLimit: parseInt(process.env[`SENDER_${i}_DAILY_LIMIT`] || '80'),
        sentToday: 0,
        lastReset: today,
      });
    }
  }
  return result;
}

// In-memory cache seeded from Postgres on startup (see loadSendersFromDb)
let _dbSenders: StoredSender[] | null = null;

export async function loadSendersFromDb(): Promise<void> {
  if (!isDbAvailable()) return;
  try {
    const rows = await dbGetSenders();
    if (rows.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      _dbSenders = rows
        .filter(r => !!r.refreshToken) // skip cleared tokens
        .map(r => ({
          email: r.email, name: r.name, refreshToken: r.refreshToken,
          dailyLimit: r.dailyLimit, sentToday: 0, lastReset: today,
        }));
      // Also write to senders.json so the rest of the code works as before
      writeSenders(_dbSenders);
      console.log(`[senders] Loaded ${_dbSenders.length} sender(s) from Postgres`);
    }
  } catch (err: any) {
    console.error('[senders] Failed to load from Postgres:', err.message);
  }
}

export function readSenders(): StoredSender[] {
  ensureDataFile();
  let fileSenders: StoredSender[] = [];
  try {
    fileSenders = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  } catch {
    console.warn('[senders] Failed to parse senders.json, using fallbacks');
  }
  // Merge: file senders (live counters) > Postgres senders > env var senders
  const envSenders = getEnvFallbackSenders();
  const fileEmails = new Set(fileSenders.map(s => s.email));
  const dbExtra = (_dbSenders || []).filter(s => !fileEmails.has(s.email));
  const allEmails = new Set([...fileEmails, ...dbExtra.map(s => s.email)]);
  const envExtra = envSenders.filter(s => !allEmails.has(s.email));
  return [...fileSenders, ...dbExtra, ...envExtra];
}

export function writeSenders(senders: StoredSender[]): void {
  ensureDataFile();
  fs.writeFileSync(DATA_PATH, JSON.stringify(senders, null, 2), 'utf-8');
}

export function upsertSender(sender: Omit<StoredSender, 'sentToday' | 'lastReset'>): void {
  const senders = readSenders();
  const today = new Date().toISOString().slice(0, 10);
  const idx = senders.findIndex(s => s.email === sender.email);
  if (idx >= 0) {
    senders[idx] = { ...senders[idx], ...sender };
  } else {
    senders.push({ ...sender, sentToday: 0, lastReset: today });
  }
  writeSenders(senders);
  // Persist to Postgres so sender survives Railway restarts
  if (isDbAvailable()) {
    dbUpsertSender(sender).catch(err => console.error('[senders] Postgres upsert error:', err.message));
  }
}

export function updateRefreshToken(email: string, refreshToken: string): void {
  const senders = readSenders();
  const sender = senders.find(s => s.email === email);
  if (sender) {
    sender.refreshToken = refreshToken;
    writeSenders(senders);
  }
  // Persist to Postgres so rotated tokens survive Railway restarts
  if (isDbAvailable() && refreshToken) {
    dbUpdateSenderToken(email, refreshToken).catch(err => console.error('[senders] Postgres token update error:', err.message));
  }
}

// Reset sentToday counters for any sender whose lastReset is not today
export function resetDailyCountersIfNeeded(): void {
  const senders = readSenders();
  const today = new Date().toISOString().slice(0, 10);
  let changed = false;
  for (const s of senders) {
    if (s.lastReset !== today) {
      s.sentToday = 0;
      s.lastReset = today;
      changed = true;
    }
  }
  if (changed) {
    writeSenders(senders);
    console.log('🔄 Daily send counters reset in senders.json');
  }
}

// Sync sentToday counts back from in-memory pipeline senders to JSON
export function syncSentCounts(pipelineSenders: { email: string; sentToday: number }[]): void {
  const senders = readSenders();
  for (const ps of pipelineSenders) {
    const stored = senders.find(s => s.email === ps.email);
    if (stored) stored.sentToday = ps.sentToday;
  }
  writeSenders(senders);
}
