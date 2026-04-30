import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock googleapis and google-auth-library before importing gmail module
vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: vi.fn() },
    gmail: vi.fn(),
  },
}));
vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn(),
}));

import { setSenders, getSenders, pickSender, resetDailyCounters, getSendStats, htmlToPlainText } from './gmail';
import { Sender } from './types';

function makeSender(overrides: Partial<Sender> = {}): Sender {
  return {
    email: 'sender@alpic.ai',
    name: 'Test Sender',
    refreshToken: 'tok_123',
    dailyLimit: 80,
    sentToday: 0,
    ...overrides,
  };
}

describe('setSenders / getSenders', () => {
  beforeEach(() => {
    // Reset internal state by injecting fresh senders
    setSenders([]);
  });

  it('stores and retrieves senders', () => {
    const s = [makeSender({ email: 'a@alpic.ai' }), makeSender({ email: 'b@alpic.ai' })];
    setSenders(s);
    expect(getSenders()).toHaveLength(2);
    expect(getSenders()[0].email).toBe('a@alpic.ai');
  });

  it('deep copies senders (no reference sharing)', () => {
    const original = [makeSender()];
    setSenders(original);
    original[0].sentToday = 999;
    expect(getSenders()[0].sentToday).toBe(0);
  });
});

describe('pickSender', () => {
  beforeEach(() => {
    setSenders([]);
  });

  it('returns null when no senders', () => {
    setSenders([]);
    expect(pickSender()).toBeNull();
  });

  it('returns null when all senders are at limit', () => {
    setSenders([
      makeSender({ email: 'a@alpic.ai', dailyLimit: 10, sentToday: 10 }),
      makeSender({ email: 'b@alpic.ai', dailyLimit: 5, sentToday: 5 }),
    ]);
    expect(pickSender()).toBeNull();
  });

  it('picks the sender with lowest utilization', () => {
    setSenders([
      makeSender({ email: 'busy@alpic.ai', dailyLimit: 100, sentToday: 80 }), // 80%
      makeSender({ email: 'fresh@alpic.ai', dailyLimit: 100, sentToday: 10 }), // 10%
      makeSender({ email: 'half@alpic.ai', dailyLimit: 100, sentToday: 50 }),  // 50%
    ]);
    const picked = pickSender();
    expect(picked).not.toBeNull();
    expect(picked!.email).toBe('fresh@alpic.ai');
  });

  it('skips senders over their limit', () => {
    setSenders([
      makeSender({ email: 'full@alpic.ai', dailyLimit: 10, sentToday: 10 }),
      makeSender({ email: 'ok@alpic.ai', dailyLimit: 10, sentToday: 3 }),
    ]);
    const picked = pickSender();
    expect(picked!.email).toBe('ok@alpic.ai');
  });

  it('picks sender with zero sends first', () => {
    setSenders([
      makeSender({ email: 'used@alpic.ai', dailyLimit: 80, sentToday: 40 }),
      makeSender({ email: 'unused@alpic.ai', dailyLimit: 80, sentToday: 0 }),
    ]);
    expect(pickSender()!.email).toBe('unused@alpic.ai');
  });
});

describe('resetDailyCounters', () => {
  it('resets all sentToday to 0', () => {
    setSenders([
      makeSender({ email: 'a@alpic.ai', sentToday: 50 }),
      makeSender({ email: 'b@alpic.ai', sentToday: 30 }),
    ]);
    resetDailyCounters();
    const senders = getSenders();
    expect(senders[0].sentToday).toBe(0);
    expect(senders[1].sentToday).toBe(0);
  });
});

describe('getSendStats', () => {
  it('returns stats per sender', () => {
    setSenders([
      makeSender({ email: 'a@alpic.ai', dailyLimit: 80, sentToday: 30 }),
      makeSender({ email: 'b@alpic.ai', dailyLimit: 50, sentToday: 50 }),
    ]);
    const stats = getSendStats();
    expect(stats).toHaveLength(2);
    expect(stats[0]).toEqual({ email: 'a@alpic.ai', sent: 30, remaining: 50 });
    expect(stats[1]).toEqual({ email: 'b@alpic.ai', sent: 50, remaining: 0 });
  });
});

describe('htmlToPlainText', () => {
  it('strips basic HTML tags', () => {
    expect(htmlToPlainText('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('converts <br> to newlines', () => {
    expect(htmlToPlainText('Line 1<br>Line 2<br/>Line 3')).toBe('Line 1\nLine 2\nLine 3');
  });

  it('converts </p> to double newlines', () => {
    const result = htmlToPlainText('<p>Para 1</p><p>Para 2</p>');
    expect(result).toContain('Para 1');
    expect(result).toContain('Para 2');
    expect(result).toContain('\n\n');
  });

  it('preserves link text and URL', () => {
    const result = htmlToPlainText('<a href="https://example.com">Click here</a>');
    expect(result).toContain('Click here');
    expect(result).toContain('https://example.com');
  });

  it('decodes HTML entities', () => {
    expect(htmlToPlainText('&amp; &lt; &gt;')).toBe('& < >');
  });

  it('handles real email body', () => {
    const html = `<p>Hi Jean,</p><p>Stripe and Adyen just launched their ChatGPT apps.</p><p>Best,<br>Stanislas</p>`;
    const plain = htmlToPlainText(html);
    expect(plain).toContain('Hi Jean,');
    expect(plain).toContain('Stripe and Adyen');
    expect(plain).toContain('Stanislas');
    expect(plain).not.toContain('<');
  });
});
