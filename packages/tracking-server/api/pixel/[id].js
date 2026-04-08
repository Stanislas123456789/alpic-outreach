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

function getAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

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

    if (!rowIndex || rowIndex < 2) return;

    // Skip known bot user agents
    const ua = (req.headers['user-agent'] || '').toLowerCase();
    const bots = ['googlebot', 'bingbot', 'slackbot', 'twitterbot', 'facebookexternalhit', 'preview'];
    if (bots.some(b => ua.includes(b))) return;

    const sheets = google.sheets({ version: 'v4', auth: getAuth() });

    // Get current values for this row (open_count and first_open_at)
    const currentRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!W${rowIndex}:X${rowIndex}`,
    });

    const currentValues = currentRes.data.values?.[0] || [];
    const currentOpenCount = parseInt(currentValues[0] || '0');
    const existingFirstOpen = currentValues[1] || '';
    const now = new Date().toISOString();

    const updates = [
      {
        range: `${SHEET_TAB}!W${rowIndex}`,
        values: [[(currentOpenCount + 1).toString()]],
      },
    ];

    // Set first_open_at only on first open
    if (!existingFirstOpen) {
      updates.push({
        range: `${SHEET_TAB}!R${rowIndex}`, // status → 'opened'
        values: [['opened']],
      });
      updates.push({
        range: `${SHEET_TAB}!X${rowIndex}`,
        values: [[now]],
      });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: updates,
      },
    });

    console.log(`📊 Open tracked: row=${rowIndex} contact=${contactId} count=${currentOpenCount + 1}`);
  } catch (err) {
    // Never let tracking errors affect the pixel response
    console.error('Tracking error:', err?.message || err);
  }
};
