// Stores the Instagram token in KV (remote). Paste the token from the Meta app
// dashboard (Instagram → API setup with Instagram login → Generate token) when
// prompted; it is stored only in KV, never written to disk.
//
//   node scripts/social/set-token.ts
//
// A short-lived token (1h) is exchanged for a 60-day one when IG_APP_SECRET is
// set; the dashboard's "Generate token" already gives a long-lived one.
import { createInterface } from 'node:readline/promises';
import { env } from './env.ts';
import { saveIgToken, whoAmI } from './instagram.ts';

async function prompt(q: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const answer = await rl.question(q);
  rl.close();
  return answer.trim();
}

let token = await prompt('Instagram access token: ');
if (!token) throw new Error('no token');
const secret = env('IG_APP_SECRET');
if (secret) {
  const res = await fetch(
    `https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: secret, access_token: token })}`,
  );
  const j = (await res.json()) as { access_token?: string };
  if (j.access_token) {
    token = j.access_token;
    console.log('exchanged for a long-lived token');
  }
}
const me = await whoAmI(token);
saveIgToken({ access_token: token, refreshed_at: new Date().toISOString(), user_id: me.user_id, username: me.username });
console.log(`saved token for @${me.username} (Instagram user ${me.user_id})`);
