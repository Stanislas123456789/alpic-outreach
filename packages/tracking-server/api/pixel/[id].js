// ============================================
// TRACKING PIXEL ENDPOINT
// Vercel Serverless Function
// GET /pixel/:contactId?row=:rowIndex
// ============================================

const { google } = require('googleapis');

// 1x1 transparent GIF (binary)
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_TAB = process.env.GOOGLE_SHEET_TAB || 'Sheet1';

// ─── Robust PEM key parser (handles \\n, CRLF, quotes, double-encoding) ──────

function parsePemKey(raw) {
  let key = raw.trim();
  if ((key.startsWith('"') && key.endsWith('"')) ||
      (key.startsWith("'") && key.endsWith("'"))) {
    try { key = JSON.parse(key); } catch { key = key.slice(1, -1); }
  }
  key = key.replace(/\\n/g, '\n');
  key = key.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  key = key.replace(/\\n/g, '\n'); // handle double-encoded
  const lines = key.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const cleaned = lines.map(l => {
    if (l.startsWith('-----')) return l;
    return l.replace(/[^A-Za-z0-9+/=]/g, '');
  }).filter(l => l.length > 0);
  return cleaned.join('\n');
}

function getAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: parsePemKey(process.env.GOOGLE_PRIVATE_KEY || ''),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

// ─── Bot / prefetch user-agent blocklist ─────────────────────────────────────
// Covers: search bots, link previews, email security scanners, and the main
// email-client image-proxy services that pre-fetch images server-side.

const BOT_UA_PATTERNS = [
  // Search / crawl bots
  'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider', 'yandexbot',
  // Social link previews
  'slackbot', 'twitterbot', 'facebookexternalhit', 'linkedinbot', 'whatsapp',
  'telegrambot', 'discordbot',
  // Email client image proxies / security scanners
  'googleimageproxy',         // Gmail image proxy
  'yahoo mail',               // Yahoo Mail fetch
  'outlookbot',               // Outlook safe-links
  'mimecast',                 // Mimecast email security
  'proofpoint',               // Proofpoint scanner
  'barracuda',                // Barracuda email security
  'cloudmark',                // Cloudmark scanner
  'symantec',                 // Symantec email scanner
  'microsoft office',         // Office link preview
  'preview',                  // Generic preview
  // Monitoring / health check
  'uptimerobot', 'pingdom', 'statuscake',
];

function isBot(ua) {
  if (!ua) return false;
  const lower = ua.toLowerCase();
  return BOT_UA_PATTERNS.some(p => lower.includes(p));
}

// ─── In-memory dedup: prevent the same (row, ip) from recording multiple opens
// within a 30-minute window. This filters out email-client re-fetches and
// security scanners that aren't caught by UA matching.
// Key format: `${rowIndex}:${ip}`, value: timestamp of first hit in window.

const openDedup = new Map();
const DEDUP_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

function isDuplicate(rowIndex, ip) {
  const key = `${rowIndex}:${ip}`;
  const last = openDedup.get(key);
  const now = Date.now();
  if (last && now - last < DEDUP_WINDOW_MS) return true;
  openDedup.set(key, now);
  // Prune entries older than the window to avoid unbounded growth
  if (openDedup.size > 5000) {
    for (const [k, ts] of openDedup) {
      if (now - ts >= DEDUP_WINDOW_MS) openDedup.delete(k);
    }
  }
  return false;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // Always return the pixel immediately (don't make user wait)
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.status(200).end(PIXEL);

  // Then process the tracking event asynchronously
  try {
    const contactId = decodeURIComponent(req.query.id || '');
    const rowIndex = parseInt(req.query.row || '0');
    const sheetId = req.query.sheetId || SHEET_ID;
    const tab = req.query.tab || SHEET_TAB;

    if (!rowIndex || rowIndex < 2) return;

    // Filter known bot user agents
    const ua = req.headers['user-agent'] || '';
    if (isBot(ua)) {
      console.log(`🤖 Bot filtered: ${ua.slice(0, 60)}`);
      return;
    }

    // Deduplicate by (row, IP) within 30-minute window
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.headers['x-real-ip']
      || req.connection?.remoteAddress
      || 'unknown';

    if (isDuplicate(rowIndex, ip)) {
      console.log(`⏭  Dedup skip: row=${rowIndex} ip=${ip}`);
      return;
    }

    const sheets = google.sheets({ version: 'v4', auth: getAuth() });

    // Read: status (W), openCount (AB), firstOpenAt (AC)
    const currentRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${tab}!W${rowIndex}`,
    });
    const currentStatus = (currentRes.data.values?.[0]?.[0] || '').toString().toLowerCase();

    const countRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${tab}!AB${rowIndex}:AC${rowIndex}`,
    });
    const countValues = countRes.data.values?.[0] || [];
    const currentOpenCount = parseInt(countValues[0] || '0');
    const existingFirstOpen = countValues[1] || '';
    const now = new Date().toISOString();

    const updates = [
      {
        range: `${tab}!AB${rowIndex}`,  // openCount = col AB (27)
        values: [[(currentOpenCount + 1).toString()]],
      },
    ];

    // Set firstOpenAt on first open
    if (!existingFirstOpen) {
      updates.push({
        range: `${tab}!AC${rowIndex}`,  // firstOpenAt = col AC (28)
        values: [[now]],
      });
    }

    // Only promote status to 'opened' if currently 'sent' (don't overwrite replied/bounced)
    if (currentStatus === 'sent') {
      updates.push({
        range: `${tab}!W${rowIndex}`,   // status = col W (22)
        values: [['opened']],
      });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: updates,
      },
    });

    console.log(`📊 Open tracked: row=${rowIndex} contact=${contactId} count=${currentOpenCount + 1} ip=${ip}`);
  } catch (err) {
    // Never let tracking errors affect the pixel response
    console.error('Tracking error:', err?.message || err);
  }
};
