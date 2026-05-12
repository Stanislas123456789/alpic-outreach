// ============================================
// REPLY & BOUNCE TRACKER
// ============================================
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { getSenders, sendFollowUp, EmailOptions } from './gmail';
import { getSentContacts, updateContactStatus, updateTouchTracking, getContactAtRow } from './sheets';
import { buildUnsubscribeFooter, buildUnsubscribeUrl, validateEmailContent } from './template';
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
      // More than 1 message in thread = got a reply (or bounce)
      if (messages.length > 1) {
        // Check ALL non-sender messages — if ANY is a bounce notification, skip the whole thread
        const BOUNCE_PATTERNS = ['mailer-daemon', 'postmaster', 'mail delivery', 'noreply', 'no-reply', 'delivery', 'undeliverable'];
        let hasBounce = false;
        let hasRealReply = false;

        for (const msg of messages) {
          const headers = msg.payload?.headers || [];
          const fromHeader = headers.find(h => h.name === 'From')?.value || '';
          // Skip messages from the sender themselves
          if (fromHeader.includes(contact.assignedTo)) continue;

          const fromLower = fromHeader.toLowerCase();
          const subjectHeader = (headers.find(h => h.name === 'Subject')?.value || '').toLowerCase();
          if (
            BOUNCE_PATTERNS.some(p => fromLower.includes(p)) ||
            subjectHeader.includes('delivery status') ||
            subjectHeader.includes('undeliverable') ||
            subjectHeader.includes('delivery failure')
          ) {
            hasBounce = true;
          } else {
            hasRealReply = true;
          }
        }

        if (hasRealReply && !hasBounce) {
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

// ─── Send follow-up emails ────────────────────────────────────────────────────

export interface FollowUpConfig {
  delayDays: number;
  subjectEn: string;
  subjectFr: string;
  bodyEn: string;
  bodyFr: string;
}

export async function sendFollowUps(
  config: FollowUpConfig,
  sheetId?: string,
  sheetTab?: string,
  config2?: FollowUpConfig,
  unsubscribeEnabled = true,
): Promise<{ sent: number; skipped: number }> {
  console.log('📨 Checking for follow-ups to send...');
  const contacts = await getSentContacts(sheetId, sheetTab);
  const senders = getSenders();
  const now = dayjs();
  let sent = 0;
  let skipped = 0;

  for (const contact of contacts) {
    // Skip opted out, bounced, or already replied
    if (contact.optedOut || contact.status === 'bounced' || contact.repliedAt) { skipped++; continue; }
    if (!contact.threadId || !contact.assignedTo) { skipped++; continue; }

    const hasSentTouch2 = !!contact.touch2SentAt;
    const hasSentTouch3 = !!contact.touch3SentAt;

    // Determine which touch to attempt
    let touchNum: 2 | 3;
    let referenceDate: string | undefined;

    if (!hasSentTouch2) {
      touchNum = 2;
      referenceDate = contact.sentAt;
    } else if (!hasSentTouch3) {
      // Touch 3 only if follow-up 2 is configured (either explicit config2 or fallback to config)
      if (!config2) { skipped++; continue; }
      touchNum = 3;
      referenceDate = contact.touch2SentAt;
    } else {
      skipped++;
      continue; // all touches sent
    }

    // Pick the right config for this touch
    const activeConfig = touchNum === 3 && config2 ? config2 : config;

    if (!referenceDate) { skipped++; continue; }
    if (now.diff(dayjs(referenceDate), 'day') < activeConfig.delayDays) { skipped++; continue; }

    const sender = senders.find(s => s.email === contact.assignedTo);
    if (!sender) { skipped++; continue; }
    // Skip if sender hit daily limit — prevents follow-ups from exhausting quota
    if (sender.sentToday >= sender.dailyLimit) { skipped++; continue; }
    // Skip if no messageId — can't create proper In-Reply-To header
    if (!contact.messageId) { skipped++; continue; }

    const isFr = (contact.language || 'EN').toUpperCase() === 'FR';
    const comps = contact.competitors || 'Your competitors';
    const compCount = comps.split(/[,/]/).filter(Boolean).length;
    const appWord = compCount === 1 ? 'app' : 'apps';
    const fill = (s: string) => s
      .replace(/{firstName}/g, contact.firstName || '')
      .replace(/{company}/g, contact.company || '')
      .replace(/{competitors}/g, comps)
      .replace(/{competitor}/g, comps.split(/[,/]/)[0]?.trim() || comps)
      .replace(/{industry}/g, (contact.industry || '').toString())
      .replace(/{appWord}/g, appWord);
    const subject = fill(isFr ? activeConfig.subjectFr : activeConfig.subjectEn);
    const unsubFooter = unsubscribeEnabled ? buildUnsubscribeFooter(contact.email, contact.language as any || 'EN') : '';
    const body = fill(isFr ? activeConfig.bodyFr : activeConfig.bodyEn) + unsubFooter;

    // Safety check: validate email content before sending
    const contentCheck = validateEmailContent(subject, body);
    if (!contentCheck.ok) {
      console.warn(`[safety] Blocked follow-up to ${contact.email}: ${contentCheck.issues.join(', ')}`);
      skipped++;
      continue;
    }

    // Dedup protection: re-read the row to guard against race conditions
    // (cron runs every 15min; the sheet may not have been updated yet from a previous run)
    try {
      const freshRow = await getContactAtRow(contact.rowIndex, sheetId, sheetTab);
      if (freshRow) {
        if (touchNum === 2 && freshRow.touch2SentAt) {
          console.log(`⏭️  Skipping touch2 for ${contact.email} — already sent (dedup re-read)`);
          skipped++;
          continue;
        }
        if (touchNum === 3 && freshRow.touch3SentAt) {
          console.log(`⏭️  Skipping touch3 for ${contact.email} — already sent (dedup re-read)`);
          skipped++;
          continue;
        }
      }
    } catch (err) {
      console.warn(`⚠️  Dedup re-read failed for row ${contact.rowIndex}, proceeding with send:`, err);
    }

    try {
      const followUpEmailOpts: EmailOptions = {
        listUnsubscribeUrl: unsubscribeEnabled ? buildUnsubscribeUrl(contact.email) : undefined,
        includePlainText: true,
      };
      const result = await sendFollowUp(
        sender,
        contact.email,
        subject,
        body,
        contact.threadId,
        contact.messageId || '',
        followUpEmailOpts,
      );

      if (result.success && result.messageId) {
        await updateTouchTracking(contact.rowIndex, touchNum, {
          sentAt: now.toISOString(),
          messageId: result.messageId,
        }, sheetId, sheetTab);
        console.log(`✅ Follow-up touch${touchNum} sent: ${contact.email}`);
        sent++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.warn(`⚠️  Follow-up failed for ${contact.email}:`, err);
      skipped++;
    }
  }

  console.log(`📨 Follow-up run done. Sent: ${sent}, Skipped: ${skipped}`);
  return { sent, skipped };
}
