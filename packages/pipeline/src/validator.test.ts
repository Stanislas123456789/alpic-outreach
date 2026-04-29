import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DNS before importing validator
vi.mock('dns', () => ({
  default: {
    resolveMx: vi.fn(),
  },
}));

import dns from 'dns';
import { validateEmail, validateBatch } from './validator';

// Helper: make resolveMx succeed with fake MX records
function mockMxSuccess(records = [{ exchange: 'mx.example.com', priority: 10 }]) {
  (dns.resolveMx as any).mockImplementation(
    (_domain: string, cb: (err: any, records: any) => void) => cb(null, records)
  );
}

function mockMxFailure() {
  (dns.resolveMx as any).mockImplementation(
    (_domain: string, cb: (err: any, records: any) => void) => cb(null, [])
  );
}

describe('validateEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMxSuccess();
  });

  // Format validation
  it('rejects empty string', async () => {
    const r = await validateEmail('');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/format/i);
  });

  it('rejects missing @', async () => {
    const r = await validateEmail('notanemail');
    expect(r.valid).toBe(false);
  });

  it('rejects missing TLD', async () => {
    const r = await validateEmail('user@localhost');
    expect(r.valid).toBe(false);
  });

  it('accepts valid email format', async () => {
    const r = await validateEmail('john@company.com');
    expect(r.valid).toBe(true);
  });

  it('trims and lowercases input', async () => {
    const r = await validateEmail('  John@COMPANY.COM  ');
    expect(r.valid).toBe(true);
  });

  // Blocked domains
  it('rejects mailinator.com', async () => {
    const r = await validateEmail('test@mailinator.com');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/disposable/i);
  });

  it('rejects yopmail.com', async () => {
    const r = await validateEmail('test@yopmail.com');
    expect(r.valid).toBe(false);
  });

  it('rejects guerrillamail.com', async () => {
    const r = await validateEmail('test@guerrillamail.com');
    expect(r.valid).toBe(false);
  });

  // MX check
  it('rejects domain with no MX records', async () => {
    mockMxFailure();
    const r = await validateEmail('user@no-mx-domain.xyz');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/MX/i);
  });

  it('returns MX records when valid', async () => {
    const r = await validateEmail('ceo@realcompany.com');
    expect(r.valid).toBe(true);
    expect(r.mxRecords).toBeDefined();
    expect(r.mxRecords!.length).toBeGreaterThan(0);
  });
});

describe('validateBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMxSuccess();
  });

  it('validates multiple emails', async () => {
    const results = await validateBatch([
      'good@company.com',
      'bad@mailinator.com',
      'also-good@firm.org',
    ]);
    expect(results.get('good@company.com')!.valid).toBe(true);
    expect(results.get('bad@mailinator.com')!.valid).toBe(false);
    expect(results.get('also-good@firm.org')!.valid).toBe(true);
  });

  it('deduplicates emails', async () => {
    const results = await validateBatch([
      'same@company.com',
      'same@company.com',
      'same@company.com',
    ]);
    // Should have 1 entry, not 3
    expect(results.size).toBe(1);
  });
});
