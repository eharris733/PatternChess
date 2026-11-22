// Signs the ad account in on the LOCAL backend without the Google OAuth dance.
//
// The recorder runs against `npm run dev` + `scripts/dev-api.sh` (wrangler
// pages dev on :8788 over the local D1 copy of production, AUTH_TEST_MODE=1
// in .dev.vars). better-auth's test-mode email+password sign-in needs a
// `credential` account, so this gives the ad user one in the LOCAL D1 with a
// fresh random password each run (hashed with better-auth's own scrypt
// hasher), then signs in through /api/auth/sign-in/email. The session cookie
// lands in the Playwright context's cookie jar.
//
// Never touches remote D1 or production: the credential row is written with
// `--local`, and email+password sign-in only exists where AUTH_TEST_MODE=1.
import { randomBytes } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import type { BrowserContext } from 'playwright';
import { d1, sqlString } from './d1.ts';
import { AD_EMAIL, BASE_URL } from './env.ts';

export async function signIn(context: BrowserContext): Promise<{ userId: string }> {
  const email = AD_EMAIL.toLowerCase();
  const [user] = d1<{ id: string }>(`SELECT id FROM "user" WHERE email = ${sqlString(email)}`);
  if (!user) throw new Error(`${email} is not in the local D1 — load the data copy first (d1/README.md)`);

  const password = randomBytes(24).toString('base64url');
  const hash = await hashPassword(password);
  const now = new Date().toISOString();
  d1(
    `INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
     VALUES (${sqlString(crypto.randomUUID())}, ${sqlString(user.id)}, 'credential', ${sqlString(user.id)},
             ${sqlString(hash)}, ${sqlString(now)}, ${sqlString(now)})
     ON CONFLICT (providerId, accountId) DO UPDATE SET password = excluded.password, updatedAt = excluded.updatedAt`,
  );

  const res = await context.request.post(`${BASE_URL}/api/auth/sign-in/email`, {
    data: { email, password },
    headers: { Origin: BASE_URL },
  });
  if (!res.ok()) {
    throw new Error(
      `sign-in failed (${res.status()}): ${await res.text()} — is scripts/dev-api.sh running with AUTH_TEST_MODE=1?`,
    );
  }
  return { userId: user.id };
}
