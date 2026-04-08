// ============================================
// EMAIL VALIDATOR
// ============================================
import dns from 'dns';
import { promisify } from 'util';

const resolveMx = promisify(dns.resolveMx);

// Known disposable/catch-all domain patterns to reject
const BLOCKED_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'tempmail.com',
  'throwaway.email', 'yopmail.com', 'sharklasers.com',
  '10minutemail.com', 'trashmail.com', 'fakeinbox.com',
]);

// Basic email regex (RFC 5322 simplified)
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  mxRecords?: dns.MxRecord[];
}

// Cache MX lookups to avoid redundant DNS queries
const mxCache = new Map<string, dns.MxRecord[] | null>();

export async function validateEmail(email: string): Promise<ValidationResult> {
  const normalized = email.trim().toLowerCase();

  // 1. Format check
  if (!EMAIL_REGEX.test(normalized)) {
    return { valid: false, reason: 'Invalid email format' };
  }

  const domain = normalized.split('@')[1];

  // 2. Blocked domain check
  if (BLOCKED_DOMAINS.has(domain)) {
    return { valid: false, reason: 'Disposable email domain' };
  }

  // 3. MX record check (with cache)
  try {
    let mxRecords: dns.MxRecord[] | null;

    if (mxCache.has(domain)) {
      mxRecords = mxCache.get(domain)!;
    } else {
      mxRecords = await resolveMx(domain).catch(() => null);
      mxCache.set(domain, mxRecords);
    }

    if (!mxRecords || mxRecords.length === 0) {
      return { valid: false, reason: 'No MX records found for domain' };
    }

    return { valid: true, mxRecords };
  } catch (err) {
    // DNS lookup failed - still try sending (might be transient)
    console.warn(`⚠️  MX lookup failed for ${domain}, allowing anyway`);
    return { valid: true, reason: 'MX lookup failed, proceeding' };
  }
}

// Validate a batch and return results
export async function validateBatch(
  emails: string[]
): Promise<Map<string, ValidationResult>> {
  const results = new Map<string, ValidationResult>();
  const unique = [...new Set(emails)];

  await Promise.all(
    unique.map(async (email) => {
      const result = await validateEmail(email);
      results.set(email, result);
    })
  );

  return results;
}
