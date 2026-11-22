import type { AppEnv } from '../../../_shared/db';
import {
  confirmEventDigest,
  isToken,
  isValidDigestEmail,
  subscribeEventDigest,
  unsubscribeEventDigest,
} from '../../../_shared/eventDigest';
import { json } from '../../../_shared/supporters';

interface Env extends AppEnv {
  /** Shared with the events site's Worker (secret PATTERNCHESS_DIGEST_SECRET there). */
  EVENTS_DIGEST_SECRET?: string;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Server-to-server API for the events site's email digest
 * (events.patternchess.com → ChessEventsData web/src/lib/subscribers.ts):
 *
 *   POST /api/events/digest/subscribe    { email, country?, region?, sourcePath? }
 *        → { data: { confirm_token, unsub_token, status, send_confirm } }
 *   POST /api/events/digest/confirm      { token } → { data: { country, region } | null }
 *   POST /api/events/digest/unsubscribe  { token } → { data: boolean }
 *
 * Authorization: Bearer EVENTS_DIGEST_SECRET. Unset secret → 503 (disabled).
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!env.EVENTS_DIGEST_SECRET) return json({ error: { code: 'disabled', message: 'digest API not configured' } }, 503);
  if (!timingSafeEqual(`Bearer ${env.EVENTS_DIGEST_SECRET}`, request.headers.get('Authorization') ?? '')) {
    return json({ error: { code: 'unauthorized', message: 'bad secret' } }, 401);
  }
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: { code: 'bad_json', message: 'Body must be a JSON object' } }, 400);
  }

  switch (String(params.action)) {
    case 'subscribe': {
      const email = str(body.email);
      if (!email || !isValidDigestEmail(email)) return json({ error: { code: 'bad_email', message: 'invalid email' } }, 400);
      const data = await subscribeEventDigest(env.DB, {
        email,
        country: str(body.country),
        region: str(body.region),
        sourcePath: str(body.sourcePath),
      });
      return json({ data });
    }
    case 'confirm':
      if (!isToken(body.token)) return json({ data: null });
      return json({ data: await confirmEventDigest(env.DB, body.token) });
    case 'unsubscribe':
      if (!isToken(body.token)) return json({ data: false });
      return json({ data: await unsubscribeEventDigest(env.DB, body.token) });
    default:
      return json({ error: { code: 'not_found', message: 'unknown action' } }, 404);
  }
};
