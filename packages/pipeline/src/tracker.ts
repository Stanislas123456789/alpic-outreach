// ============================================
// REPLY & BOUNCE TRACKER
// ============================================
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { getSenders } from './gmail';
import { getSentContacts, updateContactStatus } from './sheets';
import dayjs from 'dayjs';
import dotenv from 'dotenv';
dotenv.config();

const CLIENT_ID = process.env.GMAIL_CLIENT_ID!;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET!;

// Bounce email subjects from Gmail
const BOUNCE_SUBJECTS = [
  'delivery status notification',
  'undeliverable',
  'mail delivery failed',
  'failure notice',
  'returned mail',
  'delivery failure',
  'mail delivery subsystem',
  'delivery incomplete',
  'message not delivered',
  'unable to deliver',
];

// ─── Check replies for all sent contacts ─────────────────────────────────────

export async function checkReplies(
  sheetId?: string,
  sheetTab?: string,
): Promise<void> {
  console.log('🔍 Checking for replies...');
  const sentContacts = await getSentContacts(sheetId, sheetTab);
  let repliesFound = 0;

  for (const contact of sentContacts) {
    if (!contact.threadId || !contact.assignedTo) continue;

    try {
      const sender = getSenders().find(s => s.email === contact.assignedTo);
      if (!sender) continue;

      const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
      auth.setCredentials({ refresh_token: sender.refreshToken });
      const gmail = google.gmail({ version: 'v1', auth });

      const thread = await gmail.users.threads.get({
        userId: 'me',
        id: contact.threadId,
      });

      const messages = thread.data.messages || [];
      // More than 1 message in thread = got a reply
      if (messages.length > 1) {
        const lastMsg = messages[messages.length - 1];
        const headers = lastMsg.payload?.headers || [];
        const fromHeader = headers.find(h => h.name === 'From')?.value || '';

        // Make sure reply is NOT from the sender themselves
        if (!fromHeader.includes(contact.assignedTo)) {
          await updateContactStatus(contact.rowIndex, {
            status: 'replied',
            repliedAt: dayjs().toISOString(),
          }, sheetId, sheetTab);
          console.log(`✅ Reply detected: ${contact.email}`);
          repliesFound++;
        }
      }
    } catch (err) {
      // Thread not found or auth error - skip silently
    }
  }

  console.log(`📬 Reply check done. Found: ${repliesFound}`);
}

// ─── Check for bounces in inbox ──────────────────────────────────────────────

export async function checkBounces(
  sheetId?: string,
  sheetTab?: string,
  lookbackDays = 7,
): Promise<void> {
  console.log(`🔍 Checking for bounces (last ${lookbackDays}d)...`);
  const senders = getSenders();
  let bouncesFound = 0;

  // Load all sent contacts once (to avoid repeated sheet reads)
  const sentContacts = await getSentContacts(sheetId, sheetTab);

  for (const sender of senders) {
    try {
      const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
      auth.setCredentials({ refresh_token: sender.refreshToken });
      const gmail = google.gmail({ version: 'v1', auth });

      // Search for bounce notifications — lookbackDays controls how far back to search
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: `subject:(delivery status notification OR undeliverable OR "mail delivery failed" OR "message not delivered") newer_than:${lookbackDays}d`,
        maxResults: 200,
      });

      const messages = res.data.messages || [];

      for (const msg of messages) {
        try {
          const full = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id!,
          });

          const headers = full.data.payload?.headers || [];
          const subject = headers.find(h => h.name === 'Subject')?.value?.toLowerCase() || '';

          if (!BOUNCE_SUBJECTS.some(b => subject.includes(b))) continue;

          // Extract the bounced email address from the body and headers
          const body = extractBody(full.data.payload);
          const inReplyTo = headers.find(h => h.name === 'In-Reply-To')?.value || '';

          // Try to find the contact: first by email in bounce body,
          // then by matching the original messageId via In-Reply-To header
          let contact = null;

          const bouncedEmail = extractBouncedEmail(body);
          if (bouncedEmail) {
            contact = sentContacts.find(
              c => c.email.toLowerCase() === bouncedEmail.toLowerCase()
            ) || null;
          }

          // Fallback: match via In-Reply-To → original messageId
          if (!contact && inReplyTo) {
            const cleanMsgId = inReplyTo.replace(/[<>]/g, '').trim();
            contact = sentContacts.find(c => c.messageId === cleanMsgId) || null;
          }

          if (contact && contact.status !== 'bounced') {
            await updateContactStatus(contact.rowIndex, {
              status: 'bounced',
              bounceReason: subject.slice(0, 100),
            }, sheetId, sheetTab);
            console.log(`❌ Bounce detected: ${contact.email}`);
            bouncesFound++;
          }
        } catch (_) {}
      }
    } catch (err) {
      console.warn(`⚠️  Bounce check failed for ${sender.email}: ${err}`);
    }
  }

  console.log(`📪 Bounce check done. Found: ${bouncesFound}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractBody(payload: any): string {
  if (!payload) return '';
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractBody(part);
      if (text) return text;
    }
  }
  return '';
}

function extractBouncedEmail(body: string): string | null {
  // Ordered by specificity — most reliable patterns first
  const patterns = [
    // RFC 3464 DSN standard (most reliable)
    /Final-Recipient:\s*rfc822;\s*([\w.+%-]+@[\w.-]+\.[a-zA-Z]{2,})/i,
    /Original-Recipient:\s*rfc822;\s*([\w.+%-]+@[\w.-]+\.[a-zA-Z]{2,})/i,
    // Postfix / Sendmail
    /\bto=<([\w.+%-]+@[\w.-]+\.[a-zA-Z]{2,})>/i,
    /\brecip=<?([\w.+%-]+@[\w.-]+\.[a-zA-Z]{2,})>?/i,
    // Microsoft Exchange / Office 365
    /The following recipient\(s\) cannot be reached:\s*'?([\w.+%-]+@[\w.-]+\.[a-zA-Z]{2,})'?/i,
    /Recipient:\s*([\w.+%-]+@[\w.-]+\.[a-zA-Z]{2,})/i,
    // Generic "<email> failed" patterns
    /failed.*?<([\w.+%-]+@[\w.-]+\.[a-zA-Z]{2,})>/i,
    /undeliverable.*?([\w.+%-]+@[\w.-]+\.[a-zA-Z]{2,})/i,
    // Google Workspace NDR
    /Your message wasn't delivered to\s+([\w.+%-]+@[\w.-]+\.[a-zA-Z]{2,})/i,
    // Bare email in bounce context (last resort)
    /[\s<"]([\w.+%-]+@[\w.-]+\.[a-zA-Z]{2,})[\s>"]/,
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}
