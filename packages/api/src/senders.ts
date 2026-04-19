// ============================================
// SENDER TOKEN STORE (persistent JSON file)
// ============================================
import fs from 'fs';
import path from 'path';

// Respect DATA_DIR env var so Railway volumes can be mounted at a persistent path.
// Default: /app/data (relative to the compiled bundle at /app/dist/index.js)
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

export function readSenders(): StoredSender[] {
  ensureDataFile();
  let fileSenders: StoredSender[] = [];
  try {
    fileSenders = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  } catch {
    // ignore parse errors
  }
  // Merge env-var senders as fallback for any email not present in the file.
  // File entries take precedence (they have live sentToday counters).
  const envSenders = getEnvFallbackSenders();
  const fileEmails = new Set(fileSenders.map(s => s.email));
  return [...fileSenders, ...envSenders.filter(s => !fileEmails.has(s.email))];
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
}

export function updateRefreshToken(email: string, refreshToken: string): void {
  const senders = readSenders();
  const sender = senders.find(s => s.email === email);
  if (sender) {
    sender.refreshToken = refreshToken;
    writeSenders(senders);
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
