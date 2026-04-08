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
];

// ─── Check replies for all sent contacts ─────────────────────────────────────

export async function checkReplies(): Promise<void> {
  console.log('🔍 Checking for replies...');
  const sentContacts = await getSentContacts();
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
          });
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

export async function checkBounces(): Promise<void> {
  console.log('🔍 Checking for bounces...');
  const senders = getSenders();
  let bouncesFound = 0;

  for (const sender of senders) {
    try {
      const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
      auth.setCredentials({ refresh_token: sender.refreshToken });
      const gmail = google.gmail({ version: 'v1', auth });

      // Search for bounce notifications in the last 48h
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: 'subject:(delivery status notification OR undeliverable OR mail delivery failed) newer_than:2d',
        maxResults: 50,
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

          // Extract the bounced email address from the body
          const body = extractBody(full.data.payload);
          const bouncedEmail = extractBouncedEmail(body);

          if (bouncedEmail) {
            // Find the contact in sheets by email
            const sentContacts = await getSentContacts();
            const contact = sentContacts.find(
              c => c.email.toLowerCase() === bouncedEmail.toLowerCase()
            );

            if (contact && contact.status !== 'bounced') {
              await updateContactStatus(contact.rowIndex, {
                status: 'bounced',
                bounceReason: subject.slice(0, 100),
              });
              console.log(`❌ Bounce detected: ${bouncedEmail}`);
              bouncesFound++;
            }
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
  // Common patterns in bounce messages
  const patterns = [
    /Final-Recipient:.*?;\s*([\w.+-]+@[\w.-]+\.\w+)/i,
    /Original-Recipient:.*?;\s*([\w.+-]+@[\w.-]+\.\w+)/i,
    /failed.*?<([\w.+-]+@[\w.-]+\.\w+)>/i,
    /undeliverable.*?([\w.+-]+@[\w.-]+\.\w+)/i,
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}
