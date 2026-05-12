import { describe, it, expect, beforeEach } from 'vitest';
import { buildSubject, buildBody, buildTrackingSnippet, buildUnsubscribeFooter, buildUnsubscribeUrl, validateEmailContent } from './template';
import { Contact } from './types';

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    rowIndex: 2,
    id: 'test-id-123',
    firstName: 'Jean',
    lastName: 'Dupont',
    email: 'jean@acme.fr',
    role: 'CTO',
    company: 'Acme Corp',
    industry: 'SaaS',
    country: 'France',
    competitors: 'Stripe, Adyen',
    language: 'EN',
    status: 'pending',
    ...overrides,
  };
}

describe('buildSubject', () => {
  it('returns English subject with competitors', () => {
    const s = buildSubject(makeContact({ competitors: 'Stripe, Adyen' }));
    expect(s).toContain('Stripe');
    expect(s).toContain('Adyen');
    expect(s).toContain('ChatGPT apps');
  });

  it('uses singular "app" for single competitor', () => {
    const s = buildSubject(makeContact({ competitors: 'Stripe' }));
    expect(s).toContain('ChatGPT app');
    expect(s).not.toContain('ChatGPT apps');
  });

  it('returns French subject when language=FR', () => {
    const s = buildSubject(makeContact({ language: 'FR', competitors: 'Stripe, Adyen' }));
    expect(s).toContain('viennent de lancer');
    expect(s).toContain('ChatGPT');
  });

  it('falls back to "Your competitors" when empty', () => {
    const s = buildSubject(makeContact({ competitors: '' }));
    expect(s).toContain('Your competitors');
  });

  it('limits to 2 competitors in subject', () => {
    const s = buildSubject(makeContact({ competitors: 'Alpha, Beta, Gamma, Delta' }));
    // Should only show first 2
    expect(s).toContain('Alpha');
    expect(s).toContain('Beta');
    expect(s).not.toContain('Gamma');
    expect(s).not.toContain('Delta');
  });
});

describe('buildBody', () => {
  it('includes first name and company', () => {
    const body = buildBody(makeContact());
    expect(body).toContain('Jean');
    expect(body).toContain('Acme Corp');
  });

  it('includes tracking pixel', () => {
    const body = buildBody(makeContact());
    expect(body).toContain('<img src=');
    expect(body).toContain('width="1"');
    expect(body).toContain('test-id-123');
  });

  it('includes unsubscribe link by default', () => {
    const body = buildBody(makeContact());
    expect(body).toContain('Unsubscribe');
    expect(body).toContain('/api/optout');
  });

  it('omits unsubscribe link when disabled', () => {
    const body = buildBody(makeContact(), undefined, undefined, false);
    expect(body).not.toContain('Unsubscribe');
    expect(body).not.toContain('/api/optout');
  });

  it('renders French body for FR contacts', () => {
    const body = buildBody(makeContact({ language: 'FR' }));
    expect(body).toContain('Bonjour Jean');
    expect(body).toContain('Cordialement');
  });

  it('renders English body for EN contacts', () => {
    const body = buildBody(makeContact({ language: 'EN' }));
    expect(body).toContain('Hi Jean');
    expect(body).toContain('Best,');
  });

  it('includes OpenAI documentation link', () => {
    const body = buildBody(makeContact());
    expect(body).toContain('developers.openai.com');
  });

  it('passes sheetId and tab to tracking pixel URL', () => {
    const body = buildBody(makeContact(), 'sheet-abc', 'MyTab');
    expect(body).toContain('sheetId=sheet-abc');
    expect(body).toContain('tab=MyTab');
  });

  it('uses correct competitors formatting for French', () => {
    const body = buildBody(makeContact({ language: 'FR', competitors: 'Stripe, Adyen' }));
    expect(body).toContain('Stripe et Adyen');
  });

  it('uses "and" for English competitors', () => {
    const body = buildBody(makeContact({ language: 'EN', competitors: 'Stripe, Adyen' }));
    expect(body).toContain('Stripe and Adyen');
  });
});

describe('buildTrackingSnippet', () => {
  it('returns tracking pixel HTML', () => {
    const snippet = buildTrackingSnippet(makeContact());
    expect(snippet).toContain('<img src=');
    expect(snippet).toContain('display:none');
  });

  it('includes contact ID and row in pixel URL', () => {
    const snippet = buildTrackingSnippet(makeContact({ id: 'abc-123', rowIndex: 42 }));
    expect(snippet).toContain('abc-123');
    expect(snippet).toContain('row=42');
  });

  it('includes unsubscribe footer by default', () => {
    const snippet = buildTrackingSnippet(makeContact());
    expect(snippet).toContain('/api/optout');
  });

  it('omits unsubscribe when disabled', () => {
    const snippet = buildTrackingSnippet(makeContact(), undefined, undefined, false);
    expect(snippet).not.toContain('/api/optout');
  });
});

describe('buildUnsubscribeFooter', () => {
  it('generates HMAC-signed URL', () => {
    const footer = buildUnsubscribeFooter('test@example.com');
    expect(footer).toContain('sig=');
    expect(footer).toContain('email=test%40example.com');
  });

  it('renders French label for FR', () => {
    const footer = buildUnsubscribeFooter('test@example.com', 'FR');
    expect(footer).toContain('Se désabonner');
  });

  it('renders English label for EN', () => {
    const footer = buildUnsubscribeFooter('test@example.com', 'EN');
    expect(footer).toContain('Unsubscribe');
  });

  it('produces consistent signatures for same email', () => {
    const f1 = buildUnsubscribeFooter('same@test.com');
    const f2 = buildUnsubscribeFooter('same@test.com');
    const sig1 = f1.match(/sig=([a-f0-9]+)/)?.[1];
    const sig2 = f2.match(/sig=([a-f0-9]+)/)?.[1];
    expect(sig1).toBe(sig2);
  });

  it('produces different signatures for different emails', () => {
    const f1 = buildUnsubscribeFooter('a@test.com');
    const f2 = buildUnsubscribeFooter('b@test.com');
    const sig1 = f1.match(/sig=([a-f0-9]+)/)?.[1];
    const sig2 = f2.match(/sig=([a-f0-9]+)/)?.[1];
    expect(sig1).not.toBe(sig2);
  });
});

describe('validateEmailContent', () => {
  it('passes for valid subject and body', () => {
    const result = validateEmailContent('Hello World', '<p>Hi there!</p>');
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('fails for empty subject', () => {
    const result = validateEmailContent('', '<p>Body here</p>');
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('Subject is empty');
  });

  it('fails for empty body', () => {
    const result = validateEmailContent('Subject', '');
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('Body is empty');
  });

  it('fails for whitespace-only subject', () => {
    const result = validateEmailContent('   ', '<p>Body</p>');
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('Subject is empty');
  });

  it('detects unresolved variables in subject', () => {
    const result = validateEmailContent('Hi {firstName}', '<p>Body</p>');
    expect(result.ok).toBe(false);
    expect(result.issues.some(i => i.includes('{firstName}'))).toBe(true);
  });

  it('detects unresolved variables in body', () => {
    const result = validateEmailContent('Subject', '<p>Hi {firstName}, welcome to {company}</p>');
    expect(result.ok).toBe(false);
    expect(result.issues.some(i => i.includes('{firstName}'))).toBe(true);
    expect(result.issues.some(i => i.includes('{company}'))).toBe(true);
  });

  it('detects HTML tags in subject', () => {
    const result = validateEmailContent('<p>Broken subject</p>', '<p>Body</p>');
    expect(result.ok).toBe(false);
    expect(result.issues.some(i => i.includes('HTML tags'))).toBe(true);
  });

  it('does not flag HTML in body (expected)', () => {
    const result = validateEmailContent('Good subject', '<p>HTML body is fine</p>');
    expect(result.ok).toBe(true);
  });

  it('reports multiple issues at once', () => {
    const result = validateEmailContent('', '');
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
  });

  it('does not flag curly braces in URLs or CSS', () => {
    // Things like style="display:none" or JSON shouldn't trigger the regex
    // since the pattern requires {variableName} format
    const result = validateEmailContent('Hello', '<img style="display:none"/>');
    expect(result.ok).toBe(true);
  });

  it('deduplicates repeated unresolved variables', () => {
    const result = validateEmailContent('Subject', '{firstName} and {firstName} again');
    expect(result.ok).toBe(false);
    // Should only list {firstName} once
    const bodyIssue = result.issues.find(i => i.includes('Unresolved variables in body'));
    expect(bodyIssue).toBeDefined();
    const matches = bodyIssue!.match(/\{firstName\}/g);
    expect(matches).toHaveLength(1);
  });
});

describe('buildUnsubscribeUrl', () => {
  it('returns a URL string (not HTML)', () => {
    const url = buildUnsubscribeUrl('test@example.com');
    expect(url).not.toContain('<');
    expect(url).toContain('/api/optout');
    expect(url).toContain('sig=');
  });

  it('matches the URL inside buildUnsubscribeFooter', () => {
    const url = buildUnsubscribeUrl('test@example.com');
    const footer = buildUnsubscribeFooter('test@example.com');
    expect(footer).toContain(url);
  });

  it('encodes email in URL', () => {
    const url = buildUnsubscribeUrl('user@company.com');
    expect(url).toContain('email=user%40company.com');
  });
});
