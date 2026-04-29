import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// We test the sender store logic by creating a temp directory and
// pointing DATA_DIR to it before importing the module.
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpic-senders-'));
  process.env.DATA_DIR = tmpDir;
  // Clear module cache so the module re-reads DATA_DIR
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  // Clean up sender env vars
  for (let i = 1; i <= 5; i++) {
    delete process.env[`SENDER_${i}_EMAIL`];
    delete process.env[`SENDER_${i}_REFRESH_TOKEN`];
    delete process.env[`SENDER_${i}_NAME`];
    delete process.env[`SENDER_${i}_DAILY_LIMIT`];
  }
});

async function loadModule() {
  return await import('./senders');
}

describe('readSenders / writeSenders', () => {
  it('returns empty array when no file exists', async () => {
    const { readSenders } = await loadModule();
    expect(readSenders()).toEqual([]);
  });

  it('writes and reads senders roundtrip', async () => {
    const { readSenders, writeSenders } = await loadModule();
    const senders = [
      { email: 'stan@alpic.ai', name: 'Stan', refreshToken: 'tok1', dailyLimit: 80, sentToday: 5, lastReset: '2026-04-29' },
    ];
    writeSenders(senders);
    const loaded = readSenders();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].email).toBe('stan@alpic.ai');
    expect(loaded[0].sentToday).toBe(5);
  });
});

describe('env fallback senders', () => {
  it('loads senders from SENDER_N env vars', async () => {
    process.env.SENDER_1_EMAIL = 'env@alpic.ai';
    process.env.SENDER_1_REFRESH_TOKEN = 'env-token';
    process.env.SENDER_1_NAME = 'Env Sender';
    process.env.SENDER_1_DAILY_LIMIT = '50';

    const { readSenders } = await loadModule();
    const senders = readSenders();
    expect(senders).toHaveLength(1);
    expect(senders[0].email).toBe('env@alpic.ai');
    expect(senders[0].dailyLimit).toBe(50);
    expect(senders[0].sentToday).toBe(0);
  });

  it('file senders take precedence over env', async () => {
    process.env.SENDER_1_EMAIL = 'env@alpic.ai';
    process.env.SENDER_1_REFRESH_TOKEN = 'old-token';

    const { readSenders, writeSenders } = await loadModule();
    // Write a file sender with same email but different token
    writeSenders([
      { email: 'env@alpic.ai', name: 'File', refreshToken: 'file-token', dailyLimit: 80, sentToday: 10, lastReset: '2026-04-29' },
    ]);
    const senders = readSenders();
    expect(senders).toHaveLength(1);
    expect(senders[0].refreshToken).toBe('file-token');
    expect(senders[0].sentToday).toBe(10);
  });

  it('merges env senders not in file', async () => {
    process.env.SENDER_1_EMAIL = 'new@alpic.ai';
    process.env.SENDER_1_REFRESH_TOKEN = 'new-token';

    const { readSenders, writeSenders } = await loadModule();
    writeSenders([
      { email: 'existing@alpic.ai', name: 'Existing', refreshToken: 'tok', dailyLimit: 80, sentToday: 0, lastReset: '2026-04-29' },
    ]);
    const senders = readSenders();
    expect(senders).toHaveLength(2);
    const emails = senders.map(s => s.email);
    expect(emails).toContain('existing@alpic.ai');
    expect(emails).toContain('new@alpic.ai');
  });
});

describe('upsertSender', () => {
  it('creates new sender', async () => {
    const { readSenders, upsertSender } = await loadModule();
    upsertSender({ email: 'new@alpic.ai', name: 'New', refreshToken: 'tok', dailyLimit: 80 });
    const senders = readSenders();
    expect(senders).toHaveLength(1);
    expect(senders[0].sentToday).toBe(0);
  });

  it('updates existing sender', async () => {
    const { readSenders, upsertSender, writeSenders } = await loadModule();
    writeSenders([
      { email: 'stan@alpic.ai', name: 'Old Name', refreshToken: 'old', dailyLimit: 50, sentToday: 10, lastReset: '2026-04-29' },
    ]);
    upsertSender({ email: 'stan@alpic.ai', name: 'New Name', refreshToken: 'new', dailyLimit: 100 });
    const senders = readSenders();
    expect(senders).toHaveLength(1);
    expect(senders[0].name).toBe('New Name');
    expect(senders[0].refreshToken).toBe('new');
    expect(senders[0].dailyLimit).toBe(100);
  });
});

describe('updateRefreshToken', () => {
  it('updates token for existing sender', async () => {
    const { readSenders, writeSenders, updateRefreshToken } = await loadModule();
    writeSenders([
      { email: 'stan@alpic.ai', name: 'Stan', refreshToken: 'old', dailyLimit: 80, sentToday: 0, lastReset: '2026-04-29' },
    ]);
    updateRefreshToken('stan@alpic.ai', 'new-refreshed');
    const senders = readSenders();
    expect(senders[0].refreshToken).toBe('new-refreshed');
  });

  it('does nothing for unknown sender', async () => {
    const { readSenders, writeSenders, updateRefreshToken } = await loadModule();
    writeSenders([
      { email: 'stan@alpic.ai', name: 'Stan', refreshToken: 'tok', dailyLimit: 80, sentToday: 0, lastReset: '2026-04-29' },
    ]);
    updateRefreshToken('unknown@alpic.ai', 'whatever');
    const senders = readSenders();
    expect(senders).toHaveLength(1);
    expect(senders[0].refreshToken).toBe('tok');
  });
});

describe('resetDailyCountersIfNeeded', () => {
  it('resets counters when lastReset is yesterday', async () => {
    const { readSenders, writeSenders, resetDailyCountersIfNeeded } = await loadModule();
    writeSenders([
      { email: 'stan@alpic.ai', name: 'Stan', refreshToken: 'tok', dailyLimit: 80, sentToday: 42, lastReset: '2020-01-01' },
    ]);
    resetDailyCountersIfNeeded();
    const senders = readSenders();
    expect(senders[0].sentToday).toBe(0);
    expect(senders[0].lastReset).toBe(new Date().toISOString().slice(0, 10));
  });

  it('does not reset if already reset today', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { readSenders, writeSenders, resetDailyCountersIfNeeded } = await loadModule();
    writeSenders([
      { email: 'stan@alpic.ai', name: 'Stan', refreshToken: 'tok', dailyLimit: 80, sentToday: 42, lastReset: today },
    ]);
    resetDailyCountersIfNeeded();
    const senders = readSenders();
    expect(senders[0].sentToday).toBe(42);
  });
});

describe('syncSentCounts', () => {
  it('updates sentToday from pipeline senders', async () => {
    const { readSenders, writeSenders, syncSentCounts } = await loadModule();
    writeSenders([
      { email: 'a@alpic.ai', name: 'A', refreshToken: 'tok', dailyLimit: 80, sentToday: 0, lastReset: '2026-04-29' },
      { email: 'b@alpic.ai', name: 'B', refreshToken: 'tok', dailyLimit: 80, sentToday: 0, lastReset: '2026-04-29' },
    ]);
    syncSentCounts([
      { email: 'a@alpic.ai', sentToday: 25 },
      { email: 'b@alpic.ai', sentToday: 13 },
    ]);
    const senders = readSenders();
    expect(senders[0].sentToday).toBe(25);
    expect(senders[1].sentToday).toBe(13);
  });
});
