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
 * Robustly parse the GOOGLE_PRIVATE_KEY env var regardless of how it was stored.
 * Handles: literal \n sequences, actual newlines, Windows CRLF, editor padding,
 * surrounding quotes (JSON-stringified), and stray blank lines.
 */
function parsePemKey(raw: string): string {
  let key = raw.trim();

  // Remove surrounding quotes if the value was JSON-stringified before storing
  if ((key.startsWith('"') && key.endsWith('"')) ||
      (key.startsWith("'") && key.endsWith("'"))) {
    try {
      key = JSON.parse(key);
    } catch {
      key = key.slice(1, -1);
    }
  }

  // Convert literal \n sequences → real newlines (common in .env / Vercel UI)
  key = key.replace(/\\n/g, '\n');

  // Normalize line endings (Windows CRLF, old Mac CR)
  key = key.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Apply replace twice — handles double-encoded keys (e.g. Railway storing \\n)
  key = key.replace(/\\n/g, '\n');

  // Split, trim, filter blank lines
  const lines = key.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Strip any non-base64 characters from body lines (e.g. stray backslash from
  // mixed-encoding keys where both literal \n AND real newlines coexist).
  // PEM header/footer lines are kept verbatim.
  const cleaned = lines.map(l => {
    if (l.startsWith('-----')) return l;
    return l.replace(/[^A-Za-z0-9+/=]/g, '');
  }).filter(l => l.length > 0);

  key = cleaned.join('\n');

  if (!key.includes('-----BEGIN') || !key.includes('-----END')) {
    throw new Error(
      'GOOGLE_PRIVATE_KEY does not look like a valid PEM key. ' +
      'Make sure you copied the full private key including the -----BEGIN / -----END lines, ' +
      'and that it is stored as a single env var (with \\n between lines if your host requires it).'
    );
  }

  return key;
}

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !rawKey) {
    throw new Error(
      'Missing Google service account credentials. ' +
      'Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in your environment variables.'
    );
  }

  const key = parsePemKey(rawKey);

  return new google.auth.JWT({
    email,
    key,
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
    const DONE_STATUSES = new Set(['sent', 'bounced', 'opened', 'replied', 'skipped', 'invalid', 'sending']);
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
