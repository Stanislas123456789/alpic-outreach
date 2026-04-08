// ============================================
// SENDER TOKEN STORE (persistent JSON file)
// ============================================
import fs from 'fs';
import path from 'path';

const DATA_PATH = path.resolve(__dirname, '../data/senders.json');

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

export function readSenders(): StoredSender[] {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  } catch {
    return [];
  }
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
