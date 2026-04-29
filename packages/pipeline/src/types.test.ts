import { describe, it, expect } from 'vitest';
import { SHEET_COLUMNS } from './types';

describe('SHEET_COLUMNS', () => {
  it('has no duplicate column indices', () => {
    const indices = Object.values(SHEET_COLUMNS);
    const unique = new Set(indices);
    expect(unique.size).toBe(indices.length);
  });

  it('columns are contiguous from 0 to max', () => {
    const indices = Object.values(SHEET_COLUMNS).sort((a, b) => a - b);
    expect(indices[0]).toBe(0);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBe(indices[i - 1] + 1);
    }
  });

  it('has all required tracking fields', () => {
    const required = [
      'status', 'assignedTo', 'sentAt', 'messageId', 'threadId',
      'openCount', 'firstOpenAt', 'repliedAt', 'bounceReason',
    ];
    for (const field of required) {
      expect(SHEET_COLUMNS).toHaveProperty(field);
    }
  });

  it('has all required contact data fields', () => {
    const required = [
      'email', 'company', 'firstName', 'competitors', 'industry', 'country',
    ];
    // firstName is stored as contactName in sheet columns
    const requiredKeys = ['email', 'company', 'contactName', 'competitors', 'industry', 'country'];
    for (const field of requiredKeys) {
      expect(SHEET_COLUMNS).toHaveProperty(field);
    }
  });

  it('follow-up zone starts after tracking zone', () => {
    expect(SHEET_COLUMNS.touch2SentAt).toBeGreaterThan(SHEET_COLUMNS.bounceReason);
    expect(SHEET_COLUMNS.optedOut).toBeGreaterThan(SHEET_COLUMNS.touch3MessageId);
  });

  it('tracking zone starts after data zone', () => {
    expect(SHEET_COLUMNS.status).toBeGreaterThan(SHEET_COLUMNS.weekAdded);
  });
});
