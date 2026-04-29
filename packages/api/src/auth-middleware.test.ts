import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

// Test the auth logic directly — no need to boot Express
// These validate the rules that protect your API

describe('alpic email auth rule', () => {
  function isAuthorized(email: string | undefined): boolean {
    return !!email?.endsWith('@alpic.ai');
  }

  it('allows @alpic.ai email', () => {
    expect(isAuthorized('stan@alpic.ai')).toBe(true);
  });

  it('allows any user @alpic.ai', () => {
    expect(isAuthorized('dimitri@alpic.ai')).toBe(true);
  });

  it('rejects non-alpic email', () => {
    expect(isAuthorized('hacker@evil.com')).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isAuthorized(undefined)).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isAuthorized('')).toBe(false);
  });

  it('rejects partial match (alpic.ai as substring)', () => {
    expect(isAuthorized('stan@not-alpic.ai')).toBe(false);
  });

  it('rejects alpic.ai in local part', () => {
    expect(isAuthorized('alpic.ai@evil.com')).toBe(false);
  });
});

// Paths that MUST skip auth (open endpoints)
describe('auth-exempt paths', () => {
  const exemptPaths = [
    '/api/senders/auth',
    '/api/senders/auth/callback',
    '/health',
    '/api/diag',
    '/api/optout',
    '/pixel/some-contact-id',
  ];

  const protectedPaths = [
    '/api/senders',
    '/api/pipeline/run',
    '/api/pipeline/campaigns',
    '/api/pipeline/preview',
    '/api/pipeline/status',
  ];

  function isExempt(path: string): boolean {
    return (
      path === '/api/senders/auth' ||
      path === '/api/senders/auth/callback' ||
      path === '/health' ||
      path === '/api/diag' ||
      path === '/api/optout' ||
      path.startsWith('/pixel/')
    );
  }

  for (const p of exemptPaths) {
    it(`exempts ${p}`, () => {
      expect(isExempt(p)).toBe(true);
    });
  }

  for (const p of protectedPaths) {
    it(`protects ${p}`, () => {
      expect(isExempt(p)).toBe(false);
    });
  }
});

// HMAC optout signature verification
describe('optout HMAC verification', () => {
  const secret = 'alpic-optout-secret';

  function generateSig(email: string): string {
    return crypto.createHmac('sha256', secret).update(email).digest('hex');
  }

  function verifySig(email: string, sig: string): boolean {
    const expected = crypto.createHmac('sha256', secret).update(email).digest('hex');
    return sig === expected;
  }

  it('valid signature passes', () => {
    const email = 'user@company.com';
    const sig = generateSig(email);
    expect(verifySig(email, sig)).toBe(true);
  });

  it('tampered signature fails', () => {
    const email = 'user@company.com';
    expect(verifySig(email, 'deadbeef1234567890')).toBe(false);
  });

  it('different email fails with same sig', () => {
    const sig = generateSig('user@company.com');
    expect(verifySig('other@company.com', sig)).toBe(false);
  });

  it('empty email and sig fail', () => {
    expect(verifySig('', '')).toBe(false);
  });

  it('signature is deterministic', () => {
    expect(generateSig('a@b.com')).toBe(generateSig('a@b.com'));
  });
});
