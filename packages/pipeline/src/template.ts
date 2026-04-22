// ============================================
// EMAIL TEMPLATE ENGINE
// ============================================
import crypto from 'crypto';
import { Contact, Language } from './types';

const TRACKING_BASE = (process.env.TRACKING_BASE_URL || 'https://track.alpic.ai').replace(/\/$/, '');
const OPENAI_DOC_URL = 'https://developers.openai.com/apps-sdk/deploy';

// ─── Parse competitors string into array ─────────────────────────────────────

function parseCompetitors(competitors: string): string[] {
  return competitors
    .split(/[,/]/)
    .map(c => c.trim())
    .filter(Boolean);
}

function formatCompetitors(competitors: string[], language: Language): string {
  if (competitors.length === 0) return 'Your competitors';
  if (competitors.length === 1) return competitors[0];
  if (competitors.length === 2) {
    return language === 'FR'
      ? `${competitors[0]} et ${competitors[1]}`
      : `${competitors[0]} and ${competitors[1]}`;
  }
  const last = competitors[competitors.length - 1];
  const rest = competitors.slice(0, -1).join(', ');
  return language === 'FR' ? `${rest} et ${last}` : `${rest} and ${last}`;
}

// ─── Unsubscribe footer ───────────────────────────────────────────────────────

export function buildUnsubscribeFooter(email: string, language: Language = 'EN'): string {
  const secret = process.env.OPTOUT_SECRET || 'alpic-optout-secret';
  const sig = crypto.createHmac('sha256', secret).update(email).digest('hex');
  const url = `${TRACKING_BASE}/api/optout?email=${encodeURIComponent(email)}&sig=${sig}`;
  const label = language === 'FR' ? 'Se désabonner' : 'Unsubscribe';
  return `\n<p style="font-size:11px;color:#aaa;margin-top:24px;"><a href="${url}" style="color:#aaa;">${label}</a></p>`;
}

// ─── Subject line ─────────────────────────────────────────────────────────────

export function buildSubject(contact: Contact): string {
  const comps = parseCompetitors(contact.competitors);
  const compStr = comps.slice(0, 2).join(' & ') || 'Your competitors';

  if (contact.language === 'FR') {
    return `${compStr} viennent de lancer leurs apps ChatGPT`;
  }

  return comps.length === 1
    ? `${compStr} just launched their ChatGPT app`
    : `${compStr} just launched their ChatGPT apps`;
}

// ─── HTML body ────────────────────────────────────────────────────────────────

export function buildBody(contact: Contact): string {
  const comps = parseCompetitors(contact.competitors);
  const compStr = formatCompetitors(comps, contact.language);
  const sheetId = process.env.GOOGLE_SHEET_ID || '';
  const sheetTab = process.env.GOOGLE_SHEET_TAB || 'Master Table';
  const trackingPixel = `${TRACKING_BASE}/pixel/${encodeURIComponent(contact.id)}?row=${contact.rowIndex}&sheetId=${encodeURIComponent(sheetId)}&tab=${encodeURIComponent(sheetTab)}`;
  const appWord = comps.length === 1 ? 'app' : 'apps';

  const unsubFooter = buildUnsubscribeFooter(contact.email, contact.language as Language);

  if (contact.language === 'FR') {
    return `
<p>Bonjour ${contact.firstName},</p>

<p>${compStr} viennent de lancer leurs ${appWord} ChatGPT. Leurs services sont désormais intégrés et nativement accessibles à plus de 900M d'utilisateurs ChatGPT. Ce marché est actif depuis janvier 2026 et nous pensons que c'est une réelle opportunité pour ${contact.company}. C'est quelque chose que vous regardez&nbsp;?</p>

<p>Alpic est actuellement le premier développeur d'apps au monde et la solution de référence dans la <a href="${OPENAI_DOC_URL}">documentation OpenAI</a>. Je serais ravi de vous donner plus de détails et d'explorer la pertinence pour ${contact.company} en 15 minutes.</p>

<p>Cordialement,<br>Stanislas Michel</p>

<img src="${trackingPixel}" width="1" height="1" alt="" style="display:none"/>${unsubFooter}`.trim();
  }

  // English (default)
  return `
<p>Hi ${contact.firstName},</p>

<p>${compStr} just launched their ChatGPT ${appWord}. Their services are now integrated and natively accessible to 900M+ ChatGPT users. This market is live since January 2026 and we think it could be a great opportunity for ${contact.company}. Is it something you're looking at?</p>

<p>Alpic is currently the first app developer in the world and the reference solution in the <a href="${OPENAI_DOC_URL}">OpenAI documentation</a>. Would be happy to give you more insights and explore relevance for ${contact.company} in a quick 15-minute talk.</p>

<p>Best,<br>Stanislas Michel</p>

<img src="${trackingPixel}" width="1" height="1" alt="" style="display:none"/>${unsubFooter}`.trim();
}

// ─── Preview (for dry run logging) ───────────────────────────────────────────

export function previewEmail(contact: Contact): void {
  console.log('\n' + '─'.repeat(60));
  console.log(`TO:      ${contact.email}`);
  console.log(`FROM:    ${contact.assignedTo}`);
  console.log(`SUBJECT: ${buildSubject(contact)}`);
  console.log(`LANG:    ${contact.language}`);
  console.log(`COMPANY: ${contact.company}`);
  console.log(`COMPS:   ${contact.competitors}`);
  console.log('─'.repeat(60) + '\n');
}
