// One-time TikTok authorization (Login Kit, scopes user.info.basic + video.upload).
// Needs TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET (environment or .env.local).
//
//   node scripts/social/tiktok-auth.ts            # prints the link to open
//   pbpaste | node scripts/social/tiktok-auth.ts --finish
//
// Open the printed link, approve, and copy the address you land on (the
// social.patternchess.com page itself may 404; only its ?code= matters).
// The state check survives between the two runs in a temp file.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, requireEnv } from './env.ts';
import { saveTikTokToken, tokenRequest } from './tiktok.ts';

export const REDIRECT_URI = 'https://social.patternchess.com/tiktok-callback';
const STATE_FILE = join(tmpdir(), 'pc-tiktok-auth-state');

async function readStdin(): Promise<string> {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}

if (!parseArgs().finish) {
  const state = randomBytes(12).toString('hex');
  writeFileSync(STATE_FILE, state, { mode: 0o600 });
  const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
  url.search = new URLSearchParams({
    client_key: requireEnv('TIKTOK_CLIENT_KEY'),
    scope: 'user.info.basic,video.upload',
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    state,
  }).toString();
  console.log(`Open this link and approve, then copy the address you land on and run:\n  pbpaste | node scripts/social/tiktok-auth.ts --finish\n\n${url}`);
} else {
  if (!existsSync(STATE_FILE)) throw new Error('no pending authorization: run without --finish first');
  const state = readFileSync(STATE_FILE, 'utf8').trim();
  const landed = new URL(await readStdin());
  if (landed.searchParams.get('state') !== state) throw new Error('state mismatch: start again');
  const code = landed.searchParams.get('code');
  if (!code) throw new Error(`no code in that address (${landed.searchParams.get('error') ?? 'unknown error'})`);
  const token = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });
  if (!token.scope.includes('video.upload')) throw new Error(`granted scopes: ${token.scope} (video.upload missing)`);
  saveTikTokToken(token);
  rmSync(STATE_FILE, { force: true });
  console.log(`saved TikTok token (scopes ${token.scope}; refresh valid until ${token.refresh_expires_at})`);
}
