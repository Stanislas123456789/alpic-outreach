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
const FIRST_TRACKING_COL = 'R'; // Column 18 = R

// ─── Auth ────────────────────────────────────────────────────────────────────

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY
    ?.replace(/\\n/g, '\n')           // literal \n → real newline
    ?.split('\n')
    .map(l => l.trim())               // strip spaces Railway editor adds mid-line
    .join('\n');

  if (email && key) {
    // Service Account (recommended for pipeline)
    return new google.auth.JWT({
      email,
      key,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
      ],
    });
  }

  throw new Error(
    'Missing Google auth credentials. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in .env'
  );
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
    range: `${sheetTab}!A2:AA`, // A to AA covers all columns
  });

  const rows = res.data.values || [];
  const contacts: Contact[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const status = row[SHEET_COLUMNS.status] as EmailStatus || 'pending';

    // Only process pending rows
    if (status !== 'pending' && (status as string) !== '') continue;

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
      company: row[SHEET_COLUMNS.company] || '',
      website: row[SHEET_COLUMNS.website] || '',
      industry: row[SHEET_COLUMNS.industry] || '',
      subIndustry: row[SHEET_COLUMNS.subIndustry] || '',
      country: row[SHEET_COLUMNS.country] || '',
      region: row[SHEET_COLUMNS.region] || '',
      estRevenue: parseFloat(row[SHEET_COLUMNS.estRevenue]) || undefined,
      estEmployees: parseInt(row[SHEET_COLUMNS.estEmployees]) || undefined,
      competitors: row[SHEET_COLUMNS.competitors] || '',
      techDNA: row[SHEET_COLUMNS.techDNA] || '',
      aiInitiatives: row[SHEET_COLUMNS.aiInitiatives] || '',
      urgencyScore: parseInt(row[SHEET_COLUMNS.urgencyScore]) || undefined,
      outreachAngle: row[SHEET_COLUMNS.outreachAngle] || '',
      language: (row[SHEET_COLUMNS.language] as any) || 'EN',
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

export async function getSentContacts(): Promise<Contact[]> {
  const sheets = getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A2:AA`,
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
  }>
): Promise<void> {
  const sheets = getSheetsClient();

  // Build the range for tracking columns (R:Z = cols 18-26)
  const trackingValues = [
    updates.status ?? '',
    updates.assignedTo ?? '',
    updates.sentAt ?? '',
    updates.messageId ?? '',
    updates.threadId ?? '',
    updates.openCount?.toString() ?? '',
    updates.firstOpenAt ?? '',
    updates.repliedAt ?? '',
    updates.bounceReason ?? '',
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!${FIRST_TRACKING_COL}${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [trackingValues],
    },
  });
}

// ─── Increment open count ─────────────────────────────────────────────────────

export async function incrementOpenCount(
  rowIndex: number,
  currentCount: number,
  firstOpenAt?: string
): Promise<void> {
  const sheets = getSheetsClient();
  const newCount = currentCount + 1;

  // openCount is column W (col 23 = index 22), firstOpenAt is column X
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        {
          range: `${SHEET_TAB}!W${rowIndex}`,
          values: [[newCount.toString()]],
        },
        ...(firstOpenAt && currentCount === 0
          ? [{
              range: `${SHEET_TAB}!X${rowIndex}`,
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
    'open_count', 'first_open_at', 'replied_at', 'bounce_reason', 'language'
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!${FIRST_TRACKING_COL}1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [headers],
    },
  });

  console.log('✅ Tracking headers ensured in sheet');
}
