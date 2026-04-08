// ============================================
// OAUTH2 TOKEN GENERATOR
// Run: npm run auth --workspace=packages/pipeline
// ============================================
import { google } from 'googleapis';
import http from 'http';
import { URL } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const CLIENT_ID = process.env.GMAIL_CLIENT_ID!;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET!;
const PORT = 4567;
const REDIRECT_URI = `http://localhost:${PORT}/`;

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
];

async function main() {
  const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\n🔑 ALPIC GMAIL OAUTH2 TOKEN GENERATOR');
  console.log('─'.repeat(50));
  console.log('Opening browser... If it does not open, visit:');
  console.log('\n' + authUrl + '\n');
  console.log('─'.repeat(50));
  console.log('Waiting for Google to redirect back...\n');

  // Open browser automatically
  const { exec } = await import('child_process');
  exec(`open "${authUrl}"`);

  // Spin up a temporary server to catch the callback
  await new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:${PORT}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.end('<h2>❌ Auth failed: ' + error + '</h2>');
        server.close();
        reject(new Error(error));
        return;
      }

      if (!code) {
        res.end('<h2>No code received</h2>');
        return;
      }

      try {
        const { tokens } = await oAuth2Client.getToken(code);
        res.end('<h2 style="font-family:sans-serif;padding:40px">✅ Auth successful! You can close this tab.</h2>');
        server.close();

        console.log('\n✅ SUCCESS! Copy this refreshToken into your .env SENDERS array:\n');
        console.log('refreshToken: "' + tokens.refresh_token + '"');
        console.log('\n');
        resolve();
      } catch (err) {
        res.end('<h2>❌ Token exchange failed</h2>');
        server.close();
        reject(err);
      }
    });

    server.listen(PORT, () => {
      console.log(`Listening on http://localhost:${PORT}...`);
    });
  });
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
