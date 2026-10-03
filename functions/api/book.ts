import {
  bookEpd,
  bookKey,
  parseBookRequest,
  pickTier,
  rowToPosition,
  type BookPosition,
  type BookRow,
} from '../../src/chess/bookFormat';

interface Env {
  /** D1 database `patternchess-book`, bound as BOOK on the Pages project. */
  BOOK: D1Database;
}

/**
 * Self-hosted opening book: POST { fens: string[] } → { positions: { [epd]: BookPosition } }.
 *
 * Replaces the Lichess masters explorer proxy (rate-limited per token). The
 * data is built offline by tools/book-builder and imported with
 * scripts/book/import-d1.sh; it is read-only here, so there is nothing a
 * client can write or poison. One indexed D1 query per request.
 */

// Function responses don't get public/_headers — keep the page isolated.
const ISOLATION_HEADERS: Record<string, string> = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...ISOLATION_HEADERS },
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.BOOK) return json({ error: 'book not configured' }, 503);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const fens = parseBookRequest(body);
  if (typeof fens === 'string') return json({ error: fens }, 400);

  const epds = [...new Set(fens.map(bookEpd))];
  const keyToEpd = new Map<number, string>();
  for (const epd of epds) keyToEpd.set(await bookKey(epd), epd);
  const keys = [...keyToEpd.keys()];

  const { results } = await env.BOOK.prepare(
    `SELECT tier, key, w, d, b, cp, depth, moves FROM book_positions WHERE key IN (${keys
      .map(() => '?')
      .join(',')})`,
  )
    .bind(...keys)
    .all<BookRow & { key: number }>();

  const byEpd = new Map<string, BookRow[]>();
  for (const row of results) {
    const epd = keyToEpd.get(row.key);
    if (!epd) continue;
    const list = byEpd.get(epd);
    if (list) list.push(row);
    else byEpd.set(epd, [row]);
  }
  const positions: Record<string, BookPosition> = {};
  for (const [epd, rows] of byEpd) {
    const row = pickTier(rows);
    if (row) positions[epd] = rowToPosition(row);
  }
  return json({ positions });
};

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  // Build metadata (attribution, freshness) — cheap and cacheable.
  if (!env.BOOK) return json({ error: 'book not configured' }, 503);
  const { results } = await env.BOOK.prepare('SELECT k, v FROM book_meta').all<{ k: string; v: string }>();
  const res = json(Object.fromEntries(results.map((r) => [r.k, r.v])));
  res.headers.set('Cache-Control', 'public, max-age=3600');
  return res;
};
