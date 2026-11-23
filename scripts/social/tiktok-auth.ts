// One-time TikTok authorization (Login Kit, scopes user.info.basic + video.upload).
// Needs TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET in the environment.
//
//   node scripts/social/tiktok-auth.ts
//
// Open the printed link, approve, and paste the address you land on (the
// social.patternchess.com page itself may 404; only its ?code= matters).
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { requireEnv } from './env.ts';
import { saveTikTokToken, tokenRequest } from './tiktok.ts';

export const REDIRECT_URI = 'https://social.patternchess.com/tiktok-callback';

const state = randomBytes(12).toString('hex');
const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
url.search = new URLSearchParams({
  client_key: requireEnv('TIKTOK_CLIENT_KEY'),
  scope: 'user.info.basic,video.upload',
  response_type: 'code',
  redirect_uri: REDIRECT_URI,
  state,
}).toString();

console.log(`Open this link and approve:\n\n${url}\n`);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const landed = new URL((await rl.question('Paste the address you landed on: ')).trim());
rl.close();
if (landed.searchParams.get('state') !== state) throw new Error('state mismatch: start again');
const code = landed.searchParams.get('code');
if (!code) throw new Error(`no code in that address (${landed.searchParams.get('error') ?? 'unknown error'})`);

const token = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });
if (!token.scope.includes('video.upload')) throw new Error(`granted scopes: ${token.scope} (video.upload missing)`);
saveTikTokToken(token);
console.log(`saved TikTok token (scopes ${token.scope}; refresh valid until ${token.refresh_expires_at})`);
