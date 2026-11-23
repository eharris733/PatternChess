import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emailOutbox } from '../../workers/notifier/src/store';
import { createProfileForUser, type SessionUser } from './auth';
import type { AppEnv } from './db';
import { handlers } from './rpc/profile';
import { openTestD1, type TestD1 } from './rpc/testD1';

// The Lichess email step (src/components/OnboardingEmail.tsx) saves through
// updateContactEmail → profile.update. That write alone must queue the
// confirmation email on the notifier's next hourly run.

let db: TestD1;
const lich: SessionUser = { id: 'u-lich', email: null, name: 'KnightRider', image: null, provider: 'lichess' };

beforeEach(async () => {
  db = await openTestD1();
  const now = new Date().toISOString();
  db.sqlite
    .prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)')
    .run('u-lich', 'KnightRider', 'knightrider@lichess.invalid', now, now);
  await createProfileForUser(db as unknown as D1Database, {
    id: 'u-lich',
    email: 'knightrider@lichess.invalid',
    name: 'KnightRider',
  });
});

afterEach(() => db.close());

function call(name: string, args: Record<string, unknown>) {
  const ctx = { db, env: { DB: db } as unknown as AppEnv, user: lich, request: new Request('https://x'), waitUntil: () => {} };
  return handlers[name].handler(ctx, args);
}

describe('Lichess email step', () => {
  it('a new Lichess account has nothing to send to until it adds an address', async () => {
    const out = await emailOutbox(db as unknown as D1Database, new Date());
    expect(out.filter((r) => r.user_id === 'u-lich')).toEqual([]);
  });

  it('saving an address queues the confirmation email', async () => {
    // The same patch updateContactEmail (src/services/db/profiles.ts) sends.
    await call('profile.update', {
      patch: {
        contact_email: 'knight@example.com',
        email_opt_in: true,
        email_prompted_at: new Date().toISOString(),
        timezone: 'America/New_York',
      },
    });
    const out = await emailOutbox(db as unknown as D1Database, new Date());
    const mine = out.filter((r) => r.user_id === 'u-lich');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: 'confirm', to_email: 'knight@example.com' });
  });
});
