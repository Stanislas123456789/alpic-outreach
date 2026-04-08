// ============================================
// GMAIL OAUTH2 HELPERS FOR SENDER ONBOARDING
// ============================================
import { google } from 'googleapis';
import dotenv from 'dotenv';
dotenv.config();

export const API_PORT = parseInt(process.env.PORT || '4001');
export const REDIRECT_URI =
  process.env.OAUTH_REDIRECT_URI ||
  `http://localhost:${API_PORT}/api/senders/auth/callback`;
export const DASHBOARD_URL =
  process.env.DASHBOARD_URL || 'http://localhost:3001';

const CLIENT_ID = process.env.GMAIL_CLIENT_ID!;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET!;

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

export function createOAuthClient() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

export function generateAuthUrl(email: string): string {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',         // force consent screen so we always get refresh_token
    state: email,
    login_hint: email,         // pre-fill the email field
  });
}

export async function exchangeCode(
  code: string
): Promise<{ refreshToken: string; email: string; name: string }> {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      'No refresh_token returned. The account may have already authorized this app — ' +
      'revoke access at myaccount.google.com/permissions and try again.'
    );
  }

  // Fetch the email address from the token
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();

  return {
    refreshToken: tokens.refresh_token,
    email: data.email!,
    name: data.name || data.email!.split('@')[0],
  };
}
