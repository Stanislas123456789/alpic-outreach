// ============================================
// GOOGLE SHEETS CONNECTOR
// ============================================
import { google } from 'googleapis';
import { Contact, EmailStatus, SHEET_COLUMNS } from './types';
import dotenv from 'dotenv';
dotenv.config();

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;
const SHEET_TAB = process.env.GOOGLE_SHEET_TAB || 'Sheet1';
// Tracking columns start right after the last data column
const FIRST_TRACKING_COL = 'W'; // Column 22 = W (Master Table schema)

// ─── Retry with exponential backoff ──────────────────────────────────────────
// Handles transient Google API errors (429 rate limit, 503 service unavailable,
// network timeouts). Retries up to 3 times with 2s/4s/8s backoff.

async function withRetry<T>(fn: () => Promise<T>, label = 'API call', maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.response?.status || err?.code;
      const isRetryable = status === 429 || status === 503 || status === 'ECONNRESET' ||
        status === 'ETIMEDOUT' || /quota|rate/i.test(err.message || '');
      if (!isRetryable || attempt === maxRetries) throw err;
      const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
      console.warn(`[sheets] ${label} failed (${status}), retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}

// Google Sheets A1 notation requires single-quoting tab names that contain spaces or apostrophes.
function a1Tab(tab: string): string {
  if (/[\s']/.test(tab)) {
    return `'${tab.replace(/'/g, "\\'")}'`;
  }
  return tab;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

/**
 * Normalise a PEM private key string regardless of how it was stored/encoded.
 * Handles: literal \n, double-encoded \\n, CRLF, surrounding JSON quotes,
 * and any stray non-base64 characters left by mixed-encoding storage.
 */
function normalisePem(raw: string): string {
  let key = raw.trim();
  // Strip surrounding quotes (JSON-stringified storage)
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    try { key = JSON.parse(key); } catch { key = key.slice(1, -1); }
  }
  // Two passes: handles single and double-encoded \n sequences
  key = key.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  key = key.replace(/\\n/g, '\n');

  // Split into lines, trim whitespace, drop blanks
  const lines = key.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Strip any stray non-base64 characters from body lines only
  // (header/footer lines like -----BEGIN PRIVATE KEY----- are kept verbatim)
  const cleaned = lines.map(l =>
    l.startsWith('-----') ? l : l.replace(/[^A-Za-z0-9+/=]/g, '')
  ).filter(l => l.length > 0);

  return cleaned.join('\n');
}

function getAuth() {
  // Preferred: full service account JSON stored as a single env var.
  const jsonCreds = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (jsonCreds) {
    const creds = JSON.parse(jsonCreds);
    // Normalise the private key — Railway may double-encode newlines
    const key = normalisePem(creds.private_key);
    return new google.auth.JWT({
      email: creds.client_email,
      key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }

  // Fallback: separate GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY vars.
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !rawKey) {
    throw new Error(
      'Missing Google credentials. Set GOOGLE_SERVICE_ACCOUNT_JSON (preferred) ' +
      'or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY.'
    );
  }

  return new google.auth.JWT({
    email,
    key: normalisePem(rawKey),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

// ─── Sheets client ───────────────────────────────────────────────────────────

/**
 * Build a Sheets client using a user's OAuth2 refresh token.
 * Used as fallback when the service account is blocked by Workspace org policy.
 */
function getSheetsClientFromUserToken(refreshToken: string) {
  const CLIENT_ID = process.env.GMAIL_CLIENT_ID!;
  const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET!;
  const REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || `http://localhost:${process.env.PORT || 4001}/api/senders/auth/callback`;
  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.sheets({ version: 'v4', auth: oauth2Client });
}

let _userRefreshToken: string | null = null;

/** Called by the pipeline to inject a user refresh token as auth fallback */
export function setUserSheetsToken(refreshToken: string | null) {
  _userRefreshToken = refreshToken;
}

function getSheetsClient() {
  if (_userRefreshToken) {
    return getSheetsClientFromUserToken(_userRefreshToken);
  }
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

// ─── Read all pending contacts ───────────────────────────────────────────────

export async function getPendingContacts(
  limit = 50,
  sheetId = SHEET_ID,
  sheetTab = SHEET_TAB
): Promise<Contact[]> {
  const sheets = getSheetsClient();

  const res = await withRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${a1Tab(sheetTab)}!A2:AJ`,
  }), 'getPendingContacts');

  const rows = res.data.values || [];
  const contacts: Contact[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawStatus = (row[SHEET_COLUMNS.status] || '').toString().toLowerCase().trim();
    const DONE_STATUSES = new Set(['sent', 'bounced', 'opened', 'replied', 'skipped', 'invalid', 'yes', 'oui']);
    if (DONE_STATUSES.has(rawStatus)) continue;
    // "sending" without sentAt = stuck from a crashed campaign → treat as pending (retry)
    // "sending" with sentAt = email was sent but status update failed → skip (already sent)
    if (rawStatus === 'sending') {
      const hasSentAt = (row[SHEET_COLUMNS.sentAt] || '').toString().trim();
      if (hasSentAt) continue; // already sent, just status wasn't updated
      // else: fall through as pending — will be retried
    }
    // Skip unsubscribed contacts — CAN-SPAM compliance
    if ((row[SHEET_COLUMNS.optedOut] || '').toString().toUpperCase() === 'TRUE') continue;
    // Also skip contacts that have tracking data written (sentAt or threadId set)
    // but whose status column was never updated — prevents double-sending.
    const sentAt = (row[SHEET_COLUMNS.sentAt] || '').toString().trim();
    const threadId = (row[SHEET_COLUMNS.threadId] || '').toString().trim();
    if (sentAt || threadId) continue;
    const status = (rawStatus === 'pending' || rawStatus === '' ? 'pending' : 'pending') as EmailStatus;

    const email = row[SHEET_COLUMNS.email]?.trim();
    if (!email) continue;

    const contactName = row[SHEET_COLUMNS.contactName] || '';
    const nameParts = contactName.split(' ');

    contacts.push({
      rowIndex: i + 2, // +2 because row 1 is header and array is 0-indexed
      id: `${email}-${row[SHEET_COLUMNS.company]}`.toLowerCase().replace(/\s+/g, '-'),
      firstName: nameParts[0] || 'there',
      lastName: nameParts.slice(1).join(' '),
      email,
      role: row[SHEET_COLUMNS.role] || '',
      linkedIn: row[SHEET_COLUMNS.linkedIn] || '',
      profileGroup: row[SHEET_COLUMNS.profileGroup] || '',
      company: row[SHEET_COLUMNS.company] || '',
      website: row[SHEET_COLUMNS.website] || '',
      industry: row[SHEET_COLUMNS.industry] || '',
      subIndustry: row[SHEET_COLUMNS.subIndustry] || '',
      country: row[SHEET_COLUMNS.country] || '',
      region: row[SHEET_COLUMNS.region] || '',
      estRevenue: parseFloat(row[SHEET_COLUMNS.estRevenue]) || undefined,
      estEmployees: parseInt(row[SHEET_COLUMNS.estEmployees]) || undefined,
      competitorsLive: row[SHEET_COLUMNS.competitorsLive] || '',
      competitors: row[SHEET_COLUMNS.competitors] || row[SHEET_COLUMNS.competitorsLive] || '',
      techDNA: row[SHEET_COLUMNS.techDNA] || '',
      aiInitiatives: row[SHEET_COLUMNS.aiInitiatives] || '',
      urgencyScore: parseInt(row[SHEET_COLUMNS.urgencyScore]) || undefined,
      outreachAngle: row[SHEET_COLUMNS.outreachAngle] || '',
      emailSubject: row[SHEET_COLUMNS.emailSubject] || '',
      emailBody: row[SHEET_COLUMNS.emailBody] || '',
      weekAdded: row[SHEET_COLUMNS.weekAdded] || '',
      language: 'EN',
      status,
      assignedTo: row[SHEET_COLUMNS.assignedTo] || '',
      sentAt: row[SHEET_COLUMNS.sentAt] || '',
      messageId: row[SHEET_COLUMNS.messageId] || '',
      threadId: row[SHEET_COLUMNS.threadId] || '',
      openCount: parseInt(row[SHEET_COLUMNS.openCount]) || 0,
      firstOpenAt: row[SHEET_COLUMNS.firstOpenAt] || '',
      repliedAt: row[SHEET_COLUMNS.repliedAt] || '',
      bounceReason: row[SHEET_COLUMNS.bounceReason] || '',
    });

    if (contacts.length >= limit) break;
  }

  return contacts;
}

// ─── Get ALL contacted contacts (for wizard dedup display) ───────────────────
// Uses the same DONE_STATUSES + sentAt/threadId logic as getPendingContacts so
// the "already sent" badge in the wizard matches the KPI's total-sent count.

export async function getAllContactedContacts(
  sheetId = SHEET_ID,
  sheetTab = SHEET_TAB,
): Promise<Contact[]> {
  const sheets = getSheetsClient();
  const res = await withRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${a1Tab(sheetTab)}!A2:AJ`,
  }), 'getAllContactedContacts');
  const rows = res.data.values || [];
  const DONE_STATUSES = new Set(['sent', 'bounced', 'opened', 'replied', 'skipped', 'invalid', 'sending', 'yes', 'oui']);
  const contacts: Contact[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawStatus = (row[SHEET_COLUMNS.status] || '').toString().toLowerCase().trim();
    const sentAt = (row[SHEET_COLUMNS.sentAt] || '').toString().trim();
    const threadId = (row[SHEET_COLUMNS.threadId] || '').toString().trim();
    // Include contacts that getPendingContacts would skip
    if (!DONE_STATUSES.has(rawStatus) && !sentAt && !threadId) continue;
    const email = (row[SHEET_COLUMNS.email] || '').trim();
    if (!email) continue;
    contacts.push({
      rowIndex: i + 2,
      id: email,
      firstName: (row[SHEET_COLUMNS.contactName] || '').split(' ')[0] || '',
      lastName: '',
      email,
      role: '',
      linkedIn: '',
      profileGroup: '',
      company: row[SHEET_COLUMNS.company] || '',
      website: '',
      industry: row[SHEET_COLUMNS.industry] || '',
      subIndustry: '',
      country: row[SHEET_COLUMNS.country] || '',
      region: '',
      competitors: '',
      competitorsLive: '',
      techDNA: '',
      aiInitiatives: '',
      outreachAngle: '',
      emailSubject: '',
      emailBody: '',
      language: 'EN',
      status: (DONE_STATUSES.has(rawStatus) ? rawStatus : 'sent') as EmailStatus,
      assignedTo: row[SHEET_COLUMNS.assignedTo] || '',
      sentAt,
      messageId: row[SHEET_COLUMNS.messageId] || '',
      threadId,
      openCount: parseInt(row[SHEET_COLUMNS.openCount]) || 0,
      firstOpenAt: row[SHEET_COLUMNS.firstOpenAt] || '',
      repliedAt: row[SHEET_COLUMNS.repliedAt] || '',
      bounceReason: row[SHEET_COLUMNS.bounceReason] || '',
      weekAdded: row[SHEET_COLUMNS.weekAdded] || '',
    });
  }
  return contacts;
}

// ─── Get all sent contacts (for reply/bounce polling) ────────────────────────

export async function getSentContacts(
  sheetId = SHEET_ID,
  sheetTab = SHEET_TAB,
): Promise<Contact[]> {
  const sheets = getSheetsClient();

  const res = await withRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${a1Tab(sheetTab)}!A2:AJ`,  // extended to include follow-up columns
  }), 'getSentContacts');

  const rows = res.data.values || [];
  const contacts: Contact[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const status = row[SHEET_COLUMNS.status] as EmailStatus;

    if (status !== 'sent' && status !== 'opened') continue;

    const threadId = row[SHEET_COLUMNS.threadId];
    if (!threadId) continue;

    const fullName = row[SHEET_COLUMNS.contactName] || '';
    const firstName = fullName.split(/\s+/)[0] || '';

    contacts.push({
      rowIndex: i + 2,
      id: row[SHEET_COLUMNS.email],
      firstName,
      email: row[SHEET_COLUMNS.email] || '',
      role: row[SHEET_COLUMNS.role] || '',
      company: row[SHEET_COLUMNS.company] || '',
      industry: row[SHEET_COLUMNS.industry] || '',
      subIndustry: row[SHEET_COLUMNS.subIndustry] || '',
      country: row[SHEET_COLUMNS.country] || '',
      competitors: row[SHEET_COLUMNS.competitors] || '',
      language: ((row[SHEET_COLUMNS.country] || '').toLowerCase().startsWith('fr') ||
                 (row[SHEET_COLUMNS.region] || '').toLowerCase() === 'france') ? 'FR' : 'EN',
      status,
      assignedTo: row[SHEET_COLUMNS.assignedTo] || '',
      sentAt: row[SHEET_COLUMNS.sentAt] || '',
      messageId: row[SHEET_COLUMNS.messageId] || '',
      threadId,
      openCount: parseInt(row[SHEET_COLUMNS.openCount]) || 0,
      firstOpenAt: row[SHEET_COLUMNS.firstOpenAt] || '',
      repliedAt: row[SHEET_COLUMNS.repliedAt] || '',
      touch2SentAt: row[SHEET_COLUMNS.touch2SentAt] || '',
      touch2MessageId: row[SHEET_COLUMNS.touch2MessageId] || '',
      touch3SentAt: row[SHEET_COLUMNS.touch3SentAt] || '',
      touch3MessageId: row[SHEET_COLUMNS.touch3MessageId] || '',
      optedOut: (row[SHEET_COLUMNS.optedOut] || '').toString().toUpperCase() === 'TRUE',
    });
  }

  return contacts;
}

// ─── Update follow-up touch tracking ─────────────────────────────────────────

export async function updateTouchTracking(
  rowIndex: number,
  touch: 2 | 3,
  data: { sentAt: string; messageId: string },
  sheetId = SHEET_ID,
  sheetTab = SHEET_TAB,
): Promise<void> {
  const sheets = getSheetsClient();
  const colSentAt = touch === 2 ? 'AF' : 'AH';
  const colMsgId  = touch === 2 ? 'AG' : 'AI';

  await withRetry(() => sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: `${a1Tab(sheetTab)}!${colSentAt}${rowIndex}`, values: [[data.sentAt]] },
        { range: `${a1Tab(sheetTab)}!${colMsgId}${rowIndex}`, values: [[data.messageId]] },
      ],
    },
  }), `updateTouchTracking(row ${rowIndex}, touch ${touch})`);
}

// ─── Mark contact as opted out ───────────────────────────────────────────────

export async function markOptedOut(
  rowIndex: number,
  sheetId = SHEET_ID,
  sheetTab = SHEET_TAB,
): Promise<void> {
  const sheets = getSheetsClient();
  await withRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${a1Tab(sheetTab)}!AJ${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [['TRUE']] },
  }), `markOptedOut(row ${rowIndex})`);
}

export async function markOptedOutByEmail(
  email: string,
  sheetId = SHEET_ID,
  sheetTab = SHEET_TAB,
): Promise<boolean> {
  const sheets = getSheetsClient();
  const res = await withRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${a1Tab(sheetTab)}!H2:H`,
  }), `markOptedOutByEmail(${email})`);
  const rows = res.data.values || [];
  const idx = rows.findIndex(r => (r[0] || '').toLowerCase() === email.toLowerCase());
  if (idx === -1) return false;
  await markOptedOut(idx + 2, sheetId, sheetTab);
  return true;
}

// ─── Update a contact row after sending ──────────────────────────────────────

export async function updateContactStatus(
  rowIndex: number,
  updates: Partial<{
    status: EmailStatus;
    assignedTo: string;
    sentAt: string;
    messageId: string;
    threadId: string;
    openCount: number;
    firstOpenAt: string;
    repliedAt: string;
    bounceReason: string;
  }>,
  sheetId = SHEET_ID,
  sheetTab = SHEET_TAB,
): Promise<void> {
  const sheets = getSheetsClient();

  const colMap: Record<string, string> = {
    status: 'W',        // col 22
    assignedTo: 'X',    // col 23
    sentAt: 'Y',        // col 24
    messageId: 'Z',     // col 25
    threadId: 'AA',     // col 26
    openCount: 'AB',    // col 27
    firstOpenAt: 'AC',  // col 28
    repliedAt: 'AD',    // col 29
    bounceReason: 'AE', // col 30
  };

  const data = (Object.keys(updates) as (keyof typeof updates)[])
    .filter(key => updates[key] !== undefined && colMap[key])
    .map(key => ({
      range: `${a1Tab(sheetTab)}!${colMap[key]}${rowIndex}`,
      values: [[updates[key] !== undefined ? String(updates[key]) : '']],
    }));

  if (data.length === 0) return;

  await withRetry(() => sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data,
    },
  }), `updateContactStatus(row ${rowIndex})`);
}

// ─── Read a single contact row (for pixel tracking — avoids reading entire sheet) ─

export async function getContactAtRow(
  rowIndex: number,
  sheetId = SHEET_ID,
  sheetTab = SHEET_TAB,
): Promise<{ email: string; status: string; openCount: number } | null> {
  const sheets = getSheetsClient();
  const res = await withRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${a1Tab(sheetTab)}!A${rowIndex}:AJ${rowIndex}`,
  }), `getContactAtRow(${rowIndex})`);
  const row = (res.data.values || [])[0];
  if (!row || !row[SHEET_COLUMNS.email]) return null;
  return {
    email: row[SHEET_COLUMNS.email] || '',
    status: (row[SHEET_COLUMNS.status] || '').toLowerCase().trim(),
    openCount: parseInt(row[SHEET_COLUMNS.openCount]) || 0,
  };
}

// ─── Increment open count ─────────────────────────────────────────────────────

export async function incrementOpenCount(
  rowIndex: number,
  currentCount: number,
  firstOpenAt?: string,
  sheetId = SHEET_ID,
  sheetTab = SHEET_TAB,
): Promise<void> {
  const sheets = getSheetsClient();
  const newCount = currentCount + 1;

  // openCount is column AB (col 27), firstOpenAt is column AC (col 28)
  await withRetry(() => sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        {
          range: `${a1Tab(sheetTab)}!AB${rowIndex}`,
          values: [[newCount.toString()]],
        },
        ...(firstOpenAt && currentCount === 0
          ? [{
              range: `${a1Tab(sheetTab)}!AC${rowIndex}`,
              values: [[firstOpenAt]],
            }]
          : []),
      ],
    },
  }), `incrementOpenCount(row ${rowIndex})`);
}

// ─── Ensure tracking header columns exist ────────────────────────────────────

export async function ensureTrackingHeaders(): Promise<void> {
  const sheets = getSheetsClient();

  const headers = [
    'status', 'assigned_to', 'sent_at', 'message_id', 'thread_id',
    'open_count', 'first_open_at', 'replied_at', 'bounce_reason',
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${a1Tab(SHEET_TAB)}!${FIRST_TRACKING_COL}1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [headers],
    },
  });

  console.log('✅ Tracking headers ensured in sheet');
}

// ─── Clear legacy tracking data from emailSubject/emailBody columns ──────────
// Older schema stored sentAt (col T) and messageId (col U) where emailSubject
// and emailBody now live. This wipes those cells for rows where the value looks
// like a timestamp or hex ID so they fall back to the generated template.
export async function clearLegacyTrackingGarbage(
  sheetId = SHEET_ID,
  sheetTab = SHEET_TAB,
): Promise<number> {
  const sheets = getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${a1Tab(sheetTab)}!A2:U`,
  });

  const rows = res.data.values || [];
  const isGarbage = (s?: string) =>
    !!s && (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) || /^[0-9a-f]{8,24}$/.test(s));

  const data: { range: string; values: string[][] }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const subjectVal = row[19] as string | undefined; // col T
    const bodyVal    = row[20] as string | undefined; // col U
    const rowNum = i + 2; // 1-indexed, skip header
    if (isGarbage(subjectVal)) {
      data.push({ range: `${a1Tab(sheetTab)}!T${rowNum}`, values: [['']] });
    }
    if (isGarbage(bodyVal)) {
      data.push({ range: `${a1Tab(sheetTab)}!U${rowNum}`, values: [['']] });
    }
  }

  if (data.length === 0) {
    console.log('✅ No legacy garbage found in T/U columns');
    return 0;
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { valueInputOption: 'RAW', data },
  });

  const clearedRows = Math.ceil(data.length / 2);
  console.log(`✅ Cleared legacy tracking data from ${clearedRows} rows (T/U columns)`);
  return clearedRows;
}

// ─── Migrate tracking columns from wrong positions to correct ones ────────────
// The pipeline previously used a wrong schema where tracking started at col W (22)
// instead of the correct R (17). This migrates rows that have status in W but
// not in R by shifting all tracking data 5 columns left (W→R, X→S, Y→T …).
export async function migrateTrackingColumns(
  sheetId = SHEET_ID,
  sheetTab = SHEET_TAB,
): Promise<{ migrated: number; skipped: number }> {
  const sheets = getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${a1Tab(sheetTab)}!A2:AE`,
  });

  const rows = (res.data.values || []) as string[][];
  const STATUS_SET = new Set(['sent','bounced','opened','replied','sending','invalid','skipped','yes','oui']);

  const data: { range: string; values: string[][] }[] = [];
  let migrated = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const correctStatus = (row[17] || '').toLowerCase().trim(); // R — should have status
    const wrongStatus   = (row[22] || '').toLowerCase().trim(); // W — where wrong schema wrote it

    if (!correctStatus && STATUS_SET.has(wrongStatus)) {
      // Wrong schema wrote: status→W(22), assignedTo→X(23), sentAt→Y(24),
      //   messageId→Z(25), threadId→AA(26), openCount→AB(27),
      //   firstOpenAt→AC(28), repliedAt→AD(29), bounceReason→AE(30)
      // Correct schema expects: R(17)…Z(25), clear AA(26)…AE(30)
      const vals = [
        row[22] || '', // R  ← status (was in W)
        row[23] || '', // S  ← assignedTo (was in X)
        row[24] || '', // T  ← sentAt (was in Y)
        row[25] || '', // U  ← messageId (was in Z)
        row[26] || '', // V  ← threadId (was in AA)
        row[27] || '', // W  ← openCount (was in AB)
        row[28] || '', // X  ← firstOpenAt (was in AC)
        row[29] || '', // Y  ← repliedAt (was in AD)
        row[30] || '', // Z  ← bounceReason (was in AE)
        '',            // AA — clear (had threadId garbage)
        '',            // AB — clear
        '',            // AC — clear
        '',            // AD — clear
        '',            // AE — clear
      ];
      data.push({ range: `${a1Tab(sheetTab)}!R${rowNum}:AE${rowNum}`, values: [vals] });
      migrated++;
    } else {
      skipped++;
    }
  }

  // Batch in chunks of 500 to stay within API limits
  const CHUNK = 500;
  for (let i = 0; i < data.length; i += CHUNK) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: 'RAW', data: data.slice(i, i + CHUNK) },
    });
  }

  console.log(`✅ Migration done: ${migrated} rows migrated, ${skipped} skipped`);
  return { migrated, skipped };
}

// ─── Read sheet header row ────────────────────────────────────────────────────
// Returns the first row of the sheet as an array of { col, letter, header }
// so we can verify that SHEET_COLUMNS indices match the actual sheet layout.
export async function getSheetHeaders(
  sheetId = SHEET_ID,
  sheetTab = SHEET_TAB,
): Promise<{ index: number; letter: string; header: string }[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${a1Tab(sheetTab)}!A1:AZ1`,
  });
  const row: string[] = (res.data.values?.[0] as string[]) || [];
  return row.map((header, index) => ({
    index,
    letter: indexToCol(index),
    header: header || '',
  }));
}

function indexToCol(n: number): string {
  let s = '';
  n += 1; // 1-indexed
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ─── Init tracking headers ────────────────────────────────────────────────────

export async function initTrackingHeaders(
  sheetId = SHEET_ID,
  sheetTab = SHEET_TAB,
): Promise<{ message: string; headers?: string[] }> {
  const sheets = getSheetsClient();
  const tab = a1Tab(sheetTab);

  const check = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tab}!W1:AE1`,
  });
  const existing = (check.data.values?.[0] || []).filter(Boolean) as string[];
  // Already has headers (7+ columns W-AE present)
  if (existing.length >= 7) {
    return { message: 'Headers already present', headers: existing };
  }

  // Write tracking headers starting at W (preserving existing Contacted/Owner if present)
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${tab}!W1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [['Status', 'Assigned To', 'Sent At', 'Message ID', 'Thread ID', 'Open Count', 'First Open At', 'Replied At', 'Bounce Reason']],
    },
  });
  return { message: 'Tracking headers written to W-AE' };
}

// ─── Backfill sent emails from Gmail ─────────────────────────────────────────
// Scans each sender's "Sent" folder in Gmail, matches emails to contacts in the
// sheet by recipient address, and writes tracking data (status, sentAt, messageId,
// threadId, repliedAt) into the Y-AG tracking columns.

export async function backfillSentEmails(
  senders: Array<{ email: string; refreshToken: string }>,
  lookbackDays = 90,
  sheetId = SHEET_ID,
  sheetTab = SHEET_TAB,
): Promise<{ scanned: number; updated: number }> {
  const sheets = getSheetsClient();
  const tab = a1Tab(sheetTab);

  // Build email → rowIndex lookup from the sheet (column H = email, index 7)
  const sheetData = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tab}!A2:AG`,
  });
  const rows = sheetData.data.values || [];
  const emailToRow: Record<string, { rowIndex: number; hasTracking: boolean }> = {};
  rows.forEach((row, i) => {
    const email = (row[SHEET_COLUMNS.email] || '').toString().trim().toLowerCase();
    if (!email) return;
    // AA = threadId = index 26; if set, this row already has tracking data
    const hasTracking = !!(row[SHEET_COLUMNS.threadId]);
    emailToRow[email] = { rowIndex: i + 2, hasTracking };
  });

  const { google } = await import('googleapis');
  const CLIENT_ID = process.env.GMAIL_CLIENT_ID!;
  const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET!;
  const REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || `http://localhost:${process.env.PORT || 4001}/api/senders/auth/callback`;

  let updated = 0;
  const updates: Array<{ range: string; values: any[][] }> = [];
  const after = Math.floor((Date.now() - lookbackDays * 24 * 60 * 60 * 1000) / 1000);

  for (const sender of senders) {
    const gmailAuth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    gmailAuth.setCredentials({ refresh_token: sender.refreshToken });
    const gmail = google.gmail({ version: 'v1', auth: gmailAuth });

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: `in:sent after:${after}`,
      maxResults: 500,
    });

    const messages = listRes.data.messages || [];
    console.log(`[backfill] ${sender.email}: ${messages.length} sent messages to check`);

    for (const msg of messages) {
      try {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'metadata',
          metadataHeaders: ['To', 'Date'],
        });
        const headers = detail.data.payload?.headers || [];
        const toHeader = headers.find(h => h.name === 'To')?.value || '';
        const dateHeader = headers.find(h => h.name === 'Date')?.value || '';
        const toMatch = toHeader.match(/[\w.+\-]+@[\w.\-]+\.\w+/);
        if (!toMatch) continue;
        const toEmail = toMatch[0].toLowerCase();

        const entry = emailToRow[toEmail];
        if (!entry || entry.hasTracking) continue;

        const sentAt = dateHeader ? new Date(dateHeader).toISOString() : '';
        const threadId = detail.data.threadId || '';
        const messageId = msg.id || '';

        // Check if there's a reply in this thread
        const thread = await gmail.users.threads.get({ userId: 'me', id: threadId });
        const hasReply = (thread.data.messages || []).some(m => {
          const from = m.payload?.headers?.find(h => h.name === 'From')?.value || '';
          return !from.toLowerCase().includes(sender.email.toLowerCase());
        });

        const status = hasReply ? 'replied' : 'sent';
        // Write to W-AE (cols 22-30): status, assignedTo, sentAt, messageId, threadId, openCount, firstOpenAt, repliedAt, bounceReason
        updates.push({
          range: `${tab}!W${entry.rowIndex}:AE${entry.rowIndex}`,
          values: [[status, sender.email, sentAt, messageId, threadId, '', '', hasReply ? sentAt : '', '']],
        });
        entry.hasTracking = true; // mark as done so we don't double-write
        updated++;
      } catch {
        // skip individual message errors silently
      }
    }
  }

  // Batch write in chunks of 500
  const CHUNK = 500;
  for (let i = 0; i < updates.length; i += CHUNK) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: 'RAW', data: updates.slice(i, i + CHUNK) },
    });
  }

  console.log(`[backfill] Done: ${updated} rows updated`);
  return { scanned: Object.keys(emailToRow).length, updated };
}
