// ============================================
// ALPIC OUTREACH PIPELINE - MAIN ORCHESTRATOR
// ============================================
import cron from 'node-cron';
import chalk from 'chalk';
import dayjs from 'dayjs';
import dotenv from 'dotenv';
dotenv.config();

import { getPendingContacts, updateContactStatus, ensureTrackingHeaders } from './sheets';
import { validateEmail } from './validator';
import { buildSubject, buildBody, buildTrackingSnippet, buildUnsubscribeUrl, previewEmail } from './template';
import { pickSender, sendEmail, createDraft, resetDailyCounters, getSendStats, EmailOptions } from './gmail';
import { checkReplies, checkBounces } from './tracker';
import { Contact } from './types';
import { isWithinSendWindow, getCurrentDayInTimezone, countryToTimezone } from './timezone';

const DRY_RUN = process.env.DRY_RUN === 'true';
const TEST_EMAIL = process.env.TEST_EMAIL || '';
const MIN_DELAY = parseInt(process.env.MIN_DELAY_SECONDS || '90') * 1000;
const MAX_DELAY = parseInt(process.env.MAX_DELAY_SECONDS || '180') * 1000;
const BATCH_SIZE = 5; // contacts per run

// ─── Helpers ─────────────────────────────────────────────────────────────────

function randomDelay(min = MIN_DELAY, max = MAX_DELAY): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg: string, level: 'info' | 'success' | 'warn' | 'error' = 'info') {
  const time = dayjs().format('HH:mm:ss');
  const prefix = {
    info: chalk.blue(`[${time}] ℹ`),
    success: chalk.green(`[${time}] ✅`),
    warn: chalk.yellow(`[${time}] ⚠`),
    error: chalk.red(`[${time}] ❌`),
  }[level];
  console.log(`${prefix} ${msg}`);
}

// ─── Progress event type (mirrored from api route) ───────────────────────────

interface ProgressEvent {
  type: 'start' | 'sending' | 'sent' | 'failed' | 'invalid' | 'skipped' | 'done';
  contactId?: string;
  email?: string;
  firstName?: string;
  company?: string;
  via?: string;
  error?: string;
  total?: number;
  index?: number;
  timestamp: string;
}

// ─── Process a single contact ─────────────────────────────────────────────────

async function processContact(
  contact: Contact,
  emailOverrides: Record<string, { subject: string; body: string }>,
  onProgress?: (e: ProgressEvent) => void,
  sheetId?: string,
  sheetTab?: string,
  minDelay = MIN_DELAY,
  maxDelay = MAX_DELAY,
  draftMode = false,
  unsubscribeEnabled = true,
  emailOpts?: { ccEmail?: string; listUnsubscribe?: boolean; plainTextFallback?: boolean },
  restrictToSender?: string,
): Promise<void> {
  log(`Processing: ${contact.email} (${contact.company})`);

  onProgress?.({
    type: 'sending',
    contactId: contact.id,
    email: contact.email,
    firstName: contact.firstName,
    company: contact.company,
    timestamp: new Date().toISOString(),
  });

  // 1. Validate email
  const validation = await validateEmail(contact.email);
  if (!validation.valid) {
    log(`Invalid email ${contact.email}: ${validation.reason}`, 'warn');
    await updateContactStatus(contact.rowIndex, {
      status: 'invalid',
      bounceReason: validation.reason,
    }, sheetId, sheetTab);
    onProgress?.({
      type: 'invalid',
      contactId: contact.id,
      email: contact.email,
      firstName: contact.firstName,
      company: contact.company,
      error: validation.reason,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // 2. Pick sender (restrict to specific email if provided — user isolation)
  const sender = pickSender(restrictToSender);
  if (!sender) {
    log('All senders at daily limit. Skipping batch.', 'warn');
    onProgress?.({
      type: 'skipped',
      contactId: contact.id,
      email: contact.email,
      firstName: contact.firstName,
      company: contact.company,
      error: 'All senders at daily limit',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // 3. Assign sender to contact
  contact.assignedTo = sender.email;

  // 4. Build email (priority: manual override > pre-filled from sheet > template)
  // Guard: reject emailSubject/emailBody that look like old tracking data (ISO timestamps
  // or short hex IDs) — these come from schema migration where sentAt/messageId used to
  // live in columns T/U before emailSubject/emailBody were added there.
  const isTrackingGarbage = (s?: string) =>
    !s || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) || /^[0-9a-f]{8,24}$/.test(s);
  const override = emailOverrides[contact.id];
  const preSubject = override?.subject ?? (isTrackingGarbage(contact.emailSubject) ? undefined : contact.emailSubject);
  const preBody   = override?.body   ?? (isTrackingGarbage(contact.emailBody)    ? undefined : contact.emailBody);
  const subject = preSubject || buildSubject(contact);
  // buildBody already includes tracking pixel + unsub footer.
  // For pre-filled bodies we must append them — otherwise opens are never tracked.
  const body    = preBody
    ? preBody + buildTrackingSnippet(contact, sheetId, sheetTab, unsubscribeEnabled)
    : buildBody(contact, sheetId, sheetTab, unsubscribeEnabled);

  // 5. Dry run preview
  if (DRY_RUN) {
    previewEmail(contact);
    log(`DRY RUN - Would send to ${contact.email} via ${sender.email}`, 'warn');
    return;
  }

  // 6. Mark as sending (optimistic update to prevent double-send)
  if (!TEST_EMAIL) {
    await updateContactStatus(contact.rowIndex, {
      status: 'sending',
      assignedTo: sender.email,
    }, sheetId, sheetTab);
  }

  // 7. Send (or create draft)
  const recipient = TEST_EMAIL || contact.email;
  if (TEST_EMAIL) log(`TEST MODE — redirecting to ${TEST_EMAIL}`, 'warn');
  if (draftMode) log(`DRAFT MODE — creating draft for ${contact.email}`, 'warn');

  // Build per-message email options
  const msgOptions: EmailOptions = {
    cc: emailOpts?.ccEmail,
    listUnsubscribeUrl: (emailOpts?.listUnsubscribe !== false && unsubscribeEnabled)
      ? buildUnsubscribeUrl(contact.email)
      : undefined,
    includePlainText: emailOpts?.plainTextFallback !== false,
  };

  const result = draftMode
    ? await createDraft(sender, recipient, subject, body, msgOptions)
    : await sendEmail(sender, recipient, subject, body, msgOptions);

  if (result.success) {
    if (!TEST_EMAIL) {
      await updateContactStatus(contact.rowIndex, {
        status: draftMode ? ('pending' as any) : 'sent',
        assignedTo: sender.email,
        sentAt: draftMode ? undefined : dayjs().toISOString(),
        messageId: result.messageId,
        threadId: result.threadId,
      }, sheetId, sheetTab);
    }
    const action = draftMode ? 'Draft created for' : 'Sent to';
    log(`${action} ${contact.firstName} ${contact.lastName} @ ${contact.company} via ${sender.email}`, 'success');
    onProgress?.({
      type: 'sent',
      contactId: contact.id,
      email: contact.email,
      firstName: contact.firstName,
      company: contact.company,
      via: sender.email,
      timestamp: new Date().toISOString(),
    });
  } else {
    if (!TEST_EMAIL) {
      await updateContactStatus(contact.rowIndex, {
        status: result.bounced ? 'bounced' : 'pending',
        bounceReason: result.error?.slice(0, 100),
      }, sheetId, sheetTab);
    }
    log(`Failed: ${contact.email} — ${result.error}`, 'error');
    onProgress?.({
      type: 'failed',
      contactId: contact.id,
      email: contact.email,
      firstName: contact.firstName,
      company: contact.company,
      error: result.error,
      timestamp: new Date().toISOString(),
    });
  }
}

// ─── Main pipeline run ────────────────────────────────────────────────────────

export async function runPipeline(options?: {
  excludeIds?: string[];
  sheetId?: string;
  sheetTab?: string;
  emailOverrides?: Record<string, { subject: string; body: string }>;
  onProgress?: (event: ProgressEvent) => void;
  maxEmails?: number;
  minDelay?: number;
  maxDelay?: number;
  draftMode?: boolean;
  unsubscribeEnabled?: boolean;
  sendWindow?: { enabled: boolean; startHour: number; endHour: number };
  weekSchedule?: { activeDays: boolean[]; distributionMode: string; customWeights?: number[] };
  ccEmail?: string;                // CC address per campaign (undefined = no CC)
  listUnsubscribe?: boolean;       // Add List-Unsubscribe headers (default true)
  plainTextFallback?: boolean;     // Include plain-text alternative (default true)
  senderEmail?: string;            // Restrict sending to this email only (user isolation)
}): Promise<void> {
  const {
    onProgress,
    emailOverrides = {},
    maxEmails = BATCH_SIZE,
    minDelay = MIN_DELAY,
    maxDelay = MAX_DELAY,
    draftMode = false,
    unsubscribeEnabled = true,
    sendWindow,
    weekSchedule,
    ccEmail,
    listUnsubscribe = true,
    plainTextFallback = true,
    senderEmail,
  } = options || {};

  log(chalk.bold('🚀 Starting Alpic Outreach Pipeline'));

  if (DRY_RUN) {
    log(chalk.bgYellow.black(' DRY RUN MODE — No emails will be sent '), 'warn');
  }
  if (draftMode) {
    log(chalk.bgMagenta.white(' DRAFT MODE — Emails will be saved as drafts '), 'warn');
  }

  // Print send stats
  try {
    const stats = getSendStats();
    log('Current send stats:');
    stats.forEach(s => log(`  ${s.email}: ${s.sent}/${s.sent + s.remaining} sent today`));
  } catch (_) {}

  // Fetch pending contacts (use custom sheet if provided)
  const fetchLimit = maxEmails + (options?.excludeIds?.length || 0);
  log(`Fetching up to ${fetchLimit} pending contacts...`);
  let contacts = await getPendingContacts(
    fetchLimit,
    options?.sheetId,
    options?.sheetTab
  );

  // Filter out contacts excluded in the preview step
  if (options?.excludeIds?.length) {
    contacts = contacts.filter(c => !options.excludeIds!.includes(c.id));
  }
  contacts = contacts.slice(0, maxEmails);

  log(`Found ${contacts.length} pending contacts`);

  if (contacts.length === 0) {
    log('No pending contacts. Pipeline idle.', 'warn');
    return;
  }

  // Check week schedule: is today an active send day?
  if (weekSchedule?.activeDays) {
    const today = new Date().getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    if (!weekSchedule.activeDays[today]) {
      log(`Today (${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][today]}) is not an active send day. Skipping pipeline run.`, 'warn');
      return;
    }
  }

  // Calculate daily allocation based on distribution mode
  let dailyAllocation = contacts.length;
  if (weekSchedule?.activeDays) {
    const activeDayCount = weekSchedule.activeDays.filter(Boolean).length;
    if (activeDayCount > 0) {
      const today = new Date().getDay();
      if (weekSchedule.distributionMode === 'even') {
        dailyAllocation = Math.ceil(contacts.length / activeDayCount);
      } else if (weekSchedule.distributionMode === 'front-loaded') {
        // Front-loaded: 40/25/20/10/5% across active days
        const frontWeights = [40, 25, 20, 10, 5];
        const activeDayIndex = weekSchedule.activeDays.slice(0, today + 1).filter(Boolean).length - 1;
        const weightIndex = Math.min(activeDayIndex, frontWeights.length - 1);
        const weight = frontWeights[weightIndex] || frontWeights[frontWeights.length - 1];
        dailyAllocation = Math.ceil((contacts.length * weight) / 100);
      } else if (weekSchedule.distributionMode === 'custom' && weekSchedule.customWeights) {
        const weight = weekSchedule.customWeights[today] || 0;
        dailyAllocation = Math.ceil((contacts.length * weight) / 100);
      }
      contacts = contacts.slice(0, dailyAllocation);
      log(`Daily allocation: ${dailyAllocation} contacts (${weekSchedule.distributionMode} distribution)`);
    }
  }

  onProgress?.({ type: 'start', total: contacts.length, timestamp: new Date().toISOString() });

  // Process each contact with delay
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];

    // Check timezone-aware send window for this contact
    if (sendWindow?.enabled) {
      const inWindow = isWithinSendWindow(
        contact.country || '',
        sendWindow.startHour,
        sendWindow.endHour,
      );
      if (!inWindow) {
        const tz = countryToTimezone(contact.country || '');
        log(`Skipping ${contact.email} — outside send window in ${tz} (${contact.country || 'unknown'})`, 'warn');
        onProgress?.({
          type: 'skipped',
          contactId: contact.id,
          email: contact.email,
          firstName: contact.firstName,
          company: contact.company,
          error: `Outside send window for timezone ${tz}`,
          timestamp: new Date().toISOString(),
        });
        continue;
      }
    }

    await processContact(contact, emailOverrides, onProgress, options?.sheetId, options?.sheetTab, minDelay, maxDelay, draftMode, unsubscribeEnabled, { ccEmail, listUnsubscribe, plainTextFallback }, senderEmail);

    // Delay between sends (skip delay after last email)
    if (i < contacts.length - 1 && !DRY_RUN && !draftMode) {
      const delay = randomDelay(minDelay, maxDelay);
      log(`⏱  Waiting ${Math.round(delay / 1000)}s before next email...`);
      await sleep(delay);
    }
  }

  log(chalk.bold('✅ Pipeline run complete'), 'success');
}

// ─── Cron schedules ──────────────────────────────────────────────────────────

export async function startCronJobs(): Promise<void> {
  log('Starting cron jobs...');

  // Main pipeline: runs every 30 minutes during business hours (8am-7pm)
  cron.schedule('*/30 8-19 * * 1-5', async () => {
    log('⏰ Scheduled pipeline run triggered');
    await runPipeline().catch(err => log(`Pipeline error: ${err}`, 'error'));
  });

  // Reply/bounce check: every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    await checkReplies().catch(err => log(`Reply check error: ${err}`, 'error'));
    await checkBounces().catch(err => log(`Bounce check error: ${err}`, 'error'));
  });

  // Reset daily counters at midnight
  cron.schedule('0 0 * * *', () => {
    resetDailyCounters();
  });

  log(chalk.green('✅ Cron jobs active'));
  log('  📤 Pipeline: every 30min (Mon-Fri 8am-7pm)');
  log('  📬 Reply/bounce check: every 15min');
  log('  🔄 Daily reset: midnight');
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(chalk.bold.blue(`
  ╔═══════════════════════════════════╗
  ║   ALPIC OUTREACH PIPELINE v1.0    ║
  ║   ${DRY_RUN ? '⚠️  DRY RUN MODE              ' : '🚀 LIVE MODE                   '}  ║
  ╚═══════════════════════════════════╝
  `));

  // Ensure sheet has tracking headers
  await ensureTrackingHeaders().catch(err => {
    log(`Could not write headers: ${err}`, 'warn');
  });

  // Run immediately on start
  await runPipeline();

  // Then start cron for subsequent runs
  await startCronJobs();

  // Keep process alive
  log('Pipeline daemon running. Press Ctrl+C to stop.');
}

// Only auto-run when invoked directly (not when imported or bundled by API).
// require.main === module is unreliable in esbuild bundles — check argv instead.
const isDirectRun =
  require.main === module &&
  (process.argv[1]?.includes('/pipeline/') ||
   process.argv[1]?.endsWith('pipeline'));
if (isDirectRun) {
  main().catch(err => {
    console.error(chalk.red('Fatal error:'), err);
    process.exit(1);
  });
}
