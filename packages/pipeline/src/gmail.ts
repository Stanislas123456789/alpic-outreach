// ============================================
// GMAIL MULTI-ACCOUNT SENDER
// ============================================
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { Sender, SendResult } from './types';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const ENV_PATH = path.resolve(__dirname, '../.env');

const CLIENT_ID = process.env.GMAIL_CLIENT_ID!;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET!;

// ─── Load senders from env ────────────────────────────────────────────────────

let _senders: Sender[] | null = null;

// Cache one OAuth2 client per sender so rotated tokens are preserved in-process
const _oauthClients = new Map<string, OAuth2Client>();

// Optional callback for when Google rotates a token — the API uses this to
// persist the new token to senders.json instead of .env
type TokenRotationCallback = (email: string, refreshToken: string) => void;
let _tokenRotationCallback: TokenRotationCallback | null = null;

export function setTokenRotationCallback(cb: TokenRotationCallback): void {
  _tokenRotationCallback = cb;
}

// Allow the API to inject senders from its persistent JSON store
export function setSenders(senders: Sender[]): void {
  _senders = senders.map(s => ({ ...s }));
  // Invalidate cached OAuth clients so new tokens are picked up
  _oauthClients.clear();
}

export function getSenders(): Sender[] {
  if (_senders) return _senders;

  const raw = process.env.SENDERS;
  if (!raw) {
    throw new Error('SENDERS not set in .env — see .env.example');
  }

  _senders = JSON.parse(raw).map((s: any) => ({
    ...s,
    sentToday: 0,
  }));

  return _senders!;
}

// ─── Round-robin sender selection ────────────────────────────────────────────

export function pickSender(): Sender | null {
  const available = getSenders().filter(s => s.sentToday < s.dailyLimit);
  if (available.length === 0) return null;

  // Pick sender with lowest utilization rate
  return available.sort(
    (a, b) => (a.sentToday / a.dailyLimit) - (b.sentToday / b.dailyLimit)
  )[0];
}

// ─── Build OAuth2 client for a sender (cached per sender) ────────────────────

function getOAuthClient(sender: Sender): OAuth2Client {
  if (_oauthClients.has(sender.email)) {
    return _oauthClients.get(sender.email)!;
  }
  const client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
  client.setCredentials({ refresh_token: sender.refreshToken });
  // When Google rotates the token, persist it to .env and update in-memory
  client.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
      sender.refreshToken = tokens.refresh_token;
      client.setCredentials({ ...client.credentials, refresh_token: tokens.refresh_token });
      if (_tokenRotationCallback) {
        console.log(`[gmail] Token rotated for ${sender.email} — persisting via callback`);
        _tokenRotationCallback(sender.email, tokens.refresh_token);
      } else {
        console.log(`[gmail] Token rotated for ${sender.email} — saving to .env`);
        try {
          const envContent = fs.readFileSync(ENV_PATH, 'utf-8');
          const updated = envContent.replace(
            new RegExp(`("email":\\s*"${sender.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]*?"refreshToken":\\s*)"[^"]*"`),
            `$1"${tokens.refresh_token}"`
          );
          fs.writeFileSync(ENV_PATH, updated, 'utf-8');
        } catch (e) {
          console.warn('[gmail] Could not persist rotated token to .env:', e);
        }
      }
    }
  });
  _oauthClients.set(sender.email, client);
  return client;
}

// ─── Send a single email ──────────────────────────────────────────────────────

export async function sendEmail(
  sender: Sender,
  to: string,
  subject: string,
  htmlBody: string,
  cc?: string
): Promise<SendResult> {
  try {
    const auth = getOAuthClient(sender);
    const gmail = google.gmail({ version: 'v1', auth });

    // Build RFC 2822 message
    const messageParts = [
      `From: ${sender.name} <${sender.email}>`,
      `To: ${to}`,
      ...(cc ? [`Cc: ${cc}`] : []),
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      htmlBody,
    ];

    const rawMessage = Buffer.from(messageParts.join('\r\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: rawMessage },
    });

    // Increment sender's daily count
    sender.sentToday++;

    return {
      success: true,
      messageId: res.data.id || undefined,
      threadId: res.data.threadId || undefined,
    };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    // Only mark as bounced for real SMTP rejections, not auth/network errors
    const bounced = errorMsg.includes('550') || errorMsg.includes('554') ||
      (errorMsg.includes('invalid') && !errorMsg.includes('invalid_grant'));

    return {
      success: false,
      error: errorMsg,
      bounced,
    };
  }
}

// ─── Reset daily counters (call at midnight) ──────────────────────────────────

export function resetDailyCounters(): void {
  const senders = getSenders();
  senders.forEach(s => { s.sentToday = 0; });
  console.log('🔄 Daily send counters reset');
}

// ─── Get current send stats ───────────────────────────────────────────────────

export function getSendStats(): { email: string; sent: number; remaining: number }[] {
  return getSenders().map(s => ({
    email: s.email,
    sent: s.sentToday,
    remaining: s.dailyLimit - s.sentToday,
  }));
}
