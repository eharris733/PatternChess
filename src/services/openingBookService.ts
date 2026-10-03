import {
  BOOK_MAX_FENS,
  bookEpd,
  type BookMove,
  type BookPosition,
  type BookResponse,
} from '../chess/bookFormat';

export type { BookMove, BookPosition, BookTier } from '../chess/bookFormat';
export { BOOK_TIER_LABEL } from '../chess/bookFormat';

/**
 * Client for the self-hosted opening book (`/api/book`, D1 in production,
 * data/book/work.sqlite in dev). No rate limit: callers batch a whole game's
 * positions into one request. Session-cached per EPD, including misses
 * (positions the book doesn't have).
 */

/** EPD → position, or null when the book doesn't have it. */
const memoryCache = new Map<string, BookPosition | null>();

/**
 * Look up many positions at once. Returns a map keyed by EPD (FEN minus the
 * move counters) with null for positions outside the book, or null if the
 * request failed — callers must not treat a failure as "out of book".
 */
export async function fetchBook(fens: string[]): Promise<Map<string, BookPosition | null> | null> {
  const out = new Map<string, BookPosition | null>();
  const missing = new Map<string, string>(); // epd → a fen for it
  for (const fen of fens) {
    const epd = bookEpd(fen);
    if (memoryCache.has(epd)) out.set(epd, memoryCache.get(epd)!);
    else missing.set(epd, fen);
  }
  const pending = [...missing.entries()];
  for (let i = 0; i < pending.length; i += BOOK_MAX_FENS) {
    const chunk = pending.slice(i, i + BOOK_MAX_FENS);
    try {
      const res = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fens: chunk.map(([, fen]) => fen) }),
      });
      if (!res.ok) return null;
      const { positions } = (await res.json()) as BookResponse;
      for (const [epd] of chunk) {
        const p = positions[epd] ?? null;
        memoryCache.set(epd, p);
        out.set(epd, p);
      }
    } catch {
      return null;
    }
  }
  return out;
}

/**
 * Synchronous cache read: the position when this session already fetched
 * it (null = known to be outside the book), undefined when it never did.
 * Lets panels render a cached position on the first frame instead of
 * flashing a loading state.
 */
export function peekBookPosition(fen: string): BookPosition | null | undefined {
  const epd = bookEpd(fen);
  return memoryCache.has(epd) ? memoryCache.get(epd)! : undefined;
}

/** Single-position convenience over `fetchBook`. */
export async function fetchBookPosition(fen: string): Promise<BookPosition | null | undefined> {
  const map = await fetchBook([fen]);
  return map ? map.get(bookEpd(fen)) ?? null : undefined;
}

/** Total games that reached this position. */
export function positionGames(p: Pick<BookPosition, 'white' | 'draws' | 'black'>): number {
  return p.white + p.draws + p.black;
}

/** Game count and the mover's win % (0..100) for one book move. */
export function moveStats(
  move: BookMove,
  mover: 'white' | 'black',
): { games: number; moverWinPct: number } {
  const games = move.white + move.draws + move.black;
  const wins = mover === 'white' ? move.white : move.black;
  return { games, moverWinPct: games > 0 ? (wins / games) * 100 : 0 };
}

/** Games in this position where the side to move was titled (OTB tier only). */
export function titledGames(p: BookPosition): number {
  return p.moves.reduce((s, m) => s + m.titled, 0);
}

/** Titled games needed before a titled-player share is worth showing. */
export const MIN_TITLED_GAMES = 5;

/**
 * Share (0..100) of titled players' games in this position that chose
 * `move`; null when too few titled players reached it (always for Elite).
 */
export function titledShare(move: BookMove, p: BookPosition): number | null {
  const total = titledGames(p);
  return total >= MIN_TITLED_GAMES ? (move.titled / total) * 100 : null;
}

/** Book move = played often enough and not rejected by the engine vet. */
export function isBookMove(p: BookPosition, uci: string, minGames: number): boolean {
  const m = p.moves.find((x) => x.uci === uci);
  return !!m && m.white + m.draws + m.black >= minGames && m.sound !== false;
}
