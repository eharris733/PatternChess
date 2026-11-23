// Stores the Instagram token in KV (remote); it is never written to disk.
//
//   node scripts/social/set-token.ts                       # prompts for the token
//   pbpaste | node scripts/social/set-token.ts             # token on stdin
//   pbpaste | node scripts/social/set-token.ts --ig-user-id <id>
//
// Two kinds of token:
// - Instagram Login ("IG…", graph.instagram.com): the account comes from /me.
//   A short-lived token (1h) is exchanged for a 60-day one when IG_APP_SECRET
//   is set; the dashboard's "Generate token" already gives a long-lived one.
// - Unified login ("EA…", graph.facebook.com, a never-expiring system-user
//   token from the Meta app's Instagram use case): pass the Instagram
//   professional account id with --ig-user-id (or IG_USER_ID).
import { createInterface } from 'node:readline/promises';
import { env, parseArgs } from './env.ts';
import { igAccount, saveIgToken, whoAmI } from './instagram.ts';

async function readToken(): Promise<string> {
  if (!process.stdin.isTTY) {
    let data = '';
    for await (const chunk of process.stdin) data += chunk;
    return data.trim();
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const answer = await rl.question('Instagram access token: ');
  rl.close();
  return answer.trim();
}

const args = parseArgs(process.argv.slice(2));
let token = await readToken();
if (!token) throw new Error('no token');

if (token.startsWith('EA')) {
  const igUserId = (typeof args['ig-user-id'] === 'string' ? args['ig-user-id'] : undefined) ?? env('IG_USER_ID');
  if (!igUserId) throw new Error('a Unified-login token needs --ig-user-id <Instagram account id>');
  const acct = await igAccount(token, igUserId);
  saveIgToken({ access_token: token, refreshed_at: new Date().toISOString(), user_id: acct.id, username: acct.username, host: 'graph.facebook.com' });
  console.log(`saved system-user token for @${acct.username} (Instagram account ${acct.id}, graph.facebook.com)`);
} else {
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
  saveIgToken({ access_token: token, refreshed_at: new Date().toISOString(), user_id: me.user_id, username: me.username, host: 'graph.instagram.com' });
  console.log(`saved token for @${me.username} (Instagram user ${me.user_id}, graph.instagram.com)`);
}
