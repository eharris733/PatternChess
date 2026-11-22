import { first, nowIso, run, uuid } from './db';

/**
 * The events-site email digest (events.patternchess.com, repo ChessEventsData)
 * keeps its double-opt-in subscribers in the app D1 table
 * `event_digest_subscribers`. These are the D1 ports of the Postgres
 * service-role RPCs subscribe_event_digest / confirm_event_digest /
 * unsubscribe_event_digest, served by functions/api/events/digest/[action].ts.
 *
 * Server-to-server only: subscribe returns the confirm token, so a public
 * endpoint would let anyone skip the opt-in. The caller authenticates with
 * `Authorization: Bearer <EVENTS_DIGEST_SECRET>`.
 */

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidDigestEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

export function isToken(t: unknown): t is string {
  return typeof t === 'string' && UUID_RE.test(t);
}

interface SubscriberRow {
  id: string;
  email: string;
  country: string;
  region: string | null;
  status: 'pending' | 'active' | 'unsubscribed';
  confirm_token: string;
  unsub_token: string;
}

export interface SubscribeResult {
  confirm_token: string;
  unsub_token: string;
  status: 'pending' | 'active';
  send_confirm: boolean;
}

/**
 * Upsert a subscriber, case-insensitive on email. New → pending; previously
 * unsubscribed → pending again with a fresh confirm token; otherwise only the
 * country/region change. `send_confirm` is true while the row is pending.
 */
export async function subscribeEventDigest(
  db: D1Database,
  input: { email: string; country: string | null; region: string | null; sourcePath: string | null },
): Promise<SubscribeResult> {
  const email = input.email.trim();
  if (!isValidDigestEmail(email)) throw new Error('invalid email');
  const country = input.country ?? 'US';
  const select = 'SELECT * FROM event_digest_subscribers WHERE lower(email) = lower(?)';
  const existing = await first<SubscriberRow>(db, select, [email]);

  if (!existing) {
    await run(
      db,
      `INSERT INTO event_digest_subscribers (id, email, country, region, source_path, status, confirm_token, unsub_token, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
       ON CONFLICT DO NOTHING`,
      [uuid(), email, country, input.region, input.sourcePath, uuid(), uuid(), nowIso()],
    );
  } else if (existing.status === 'unsubscribed') {
    await run(
      db,
      `UPDATE event_digest_subscribers
       SET status = 'pending', confirm_token = ?, country = ?, region = ?, source_path = ?, unsubscribed_at = NULL
       WHERE id = ?`,
      [uuid(), country, input.region, input.sourcePath, existing.id],
    );
  } else {
    await run(db, 'UPDATE event_digest_subscribers SET country = ?, region = ? WHERE id = ?', [
      country,
      input.region,
      existing.id,
    ]);
  }

  const row = await first<SubscriberRow>(db, select, [email]);
  if (!row) throw new Error('subscriber row missing after upsert');
  const status = row.status === 'active' ? 'active' : 'pending';
  return { confirm_token: row.confirm_token, unsub_token: row.unsub_token, status, send_confirm: row.status === 'pending' };
}

/** pending/active → active (confirmed_at kept from the first time). Null when unknown or unsubscribed. */
export async function confirmEventDigest(
  db: D1Database,
  token: string,
): Promise<{ country: string; region: string | null } | null> {
  return first<{ country: string; region: string | null }>(
    db,
    `UPDATE event_digest_subscribers
     SET status = 'active', confirmed_at = coalesce(confirmed_at, ?)
     WHERE confirm_token = ? AND status <> 'unsubscribed'
     RETURNING country, region`,
    [nowIso(), token],
  );
}

/** True when the token matched a subscriber (unsubscribing twice is still true). */
export async function unsubscribeEventDigest(db: D1Database, token: string): Promise<boolean> {
  const meta = await run(
    db,
    "UPDATE event_digest_subscribers SET status = 'unsubscribed', unsubscribed_at = ? WHERE unsub_token = ?",
    [nowIso(), token],
  );
  return (meta.changes ?? 0) > 0;
}
