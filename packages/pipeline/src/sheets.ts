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
const FIRST_TRACKING_COL = 'W'; // Column 23 = W (new schema)

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

function getSheetsClient() {
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

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${a1Tab(sheetTab)}!A2:AE`,
  });

  const rows = res.data.values || [];
  const contacts: Contact[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawStatus = (row[SHEET_COLUMNS.status] || '').toString().toLowerCase().trim();
    const DONE_STATUSES = new Set(['sent', 'bounced', 'opened', 'replied', 'skipped', 'invalid', 'sending', 'yes', 'oui']);
    if (DONE_STATUSES.has(rawStatus)) continue;
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
      competitors: row[SHEET_COLUMNS.competitors] || '',
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

// ─── Get all sent contacts (for reply/bounce polling) ────────────────────────

export async function getSentContacts(
  sheetId = SHEET_ID,
  sheetTab = SHEET_TAB,
): Promise<Contact[]> {
  const sheets = getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${a1Tab(sheetTab)}!A2:AE`,
  });

  const rows = res.data.values || [];
  const contacts: Contact[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const status = row[SHEET_COLUMNS.status] as EmailStatus;

    if (status !== 'sent' && status !== 'opened') continue;

    const threadId = row[SHEET_COLUMNS.threadId];
    if (!threadId) continue;

    contacts.push({
      rowIndex: i + 2,
      id: row[SHEET_COLUMNS.email],
      firstName: '',
      email: row[SHEET_COLUMNS.email] || '',
      role: '',
      company: row[SHEET_COLUMNS.company] || '',
      industry: row[SHEET_COLUMNS.industry] || '',
      country: '',
      competitors: '',
      language: 'EN',
      status,
      assignedTo: row[SHEET_COLUMNS.assignedTo] || '',
      sentAt: row[SHEET_COLUMNS.sentAt] || '',
      messageId: row[SHEET_COLUMNS.messageId] || '',
      threadId,
      openCount: parseInt(row[SHEET_COLUMNS.openCount]) || 0,
      firstOpenAt: row[SHEET_COLUMNS.firstOpenAt] || '',
      repliedAt: row[SHEET_COLUMNS.repliedAt] || '',
    });
  }

  return contacts;
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
    status: 'W',       // col 22
    assignedTo: 'X',   // col 23
    sentAt: 'Y',       // col 24
    messageId: 'Z',    // col 25
    threadId: 'AA',    // col 26
    openCount: 'AB',   // col 27
    firstOpenAt: 'AC', // col 28
    repliedAt: 'AD',   // col 29
    bounceReason: 'AE',// col 30
  };

  const data = (Object.keys(updates) as (keyof typeof updates)[])
    .filter(key => updates[key] !== undefined && colMap[key])
    .map(key => ({
      range: `${a1Tab(sheetTab)}!${colMap[key]}${rowIndex}`,
      values: [[updates[key] !== undefined ? String(updates[key]) : '']],
    }));

  if (data.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data,
    },
  });
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

  // openCount is column AB (col 27 = index 27), firstOpenAt is column AC
  await sheets.spreadsheets.values.batchUpdate({
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
  });
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
