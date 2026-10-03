/**
 * Wire format of the self-hosted opening book (`/api/book`). Shared by the
 * Pages Function (functions/api/book.ts), the dev middleware
 * (scripts/devBookProxy.mjs) and the client (services/openingBookService.ts).
 * Pure — no DOM, no Node, no Workers APIs beyond Web Crypto.
 *
 * Rows are built offline by tools/book-builder: positions keyed by EPD, two
 * tiers (OTB broadcasts with both players 2200+; Lichess Elite online), each
 * move engine-vetted (`sound`) against the Lichess eval DB + native Stockfish.
 */

export type BookTier = 'otb' | 'elite';

/** The only source of user-facing tier labels ("<label> players chose …"). */
export const BOOK_TIER_LABEL: Record<BookTier, string> = {
  otb: 'OTB 2200+',
  elite: 'Lichess Elite',
};

/**
 * Rating floor of each tier (the lower-rated player in every game). OTB:
 * both players 2200+ (tools/book-builder OTB_MIN_ELO). Elite: the Lichess
 * Elite Database's last 36 months are 2500+ vs 2300+. The only source of
 * the "players rated N+" phrase — never hardcode a rating in copy.
 */
export const BOOK_TIER_MIN_ELO: Record<BookTier, number> = { otb: 2200, elite: 2300 };

/** "players rated 2200+ (OTB)" / "players rated 2300+ on Lichess". */
export function bookPlayersLabel(tier: BookTier): string {
  return tier === 'otb'
    ? `players rated ${BOOK_TIER_MIN_ELO.otb}+ (OTB)`
    : `players rated ${BOOK_TIER_MIN_ELO.elite}+ on Lichess`;
}

/** Stored tier ids (tools/book-builder `Tier::id`). */
export const BOOK_TIER_BY_ID: Record<number, BookTier> = { 0: 'otb', 1: 'elite' };

/** Max FENs per `/api/book` request — a game's first 30 plies fit with room. */
export const BOOK_MAX_FENS = 64;

/**
 * The OTB tier answers when it has at least this many games in the position
 * (MIN_POSITION_GAMES in openingDeviation.ts); otherwise Elite fills in.
 */
export const BOOK_OTB_MIN_GAMES = 10;

export interface BookMove {
  /** Standard UCI — castling is king-to-g/c-file (e1g1), like chess.js. */
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  /** Games where the side playing this move was titled (OTB tier only). */
  titled: number;
  /** Eval after the move from the mover's perspective; null if unknown. */
  cp: number | null;
  /** Within 8% winning chances of the best option; null if not evaluated. */
  sound: boolean | null;
}

export interface BookPosition {
  tier: BookTier;
  white: number;
  draws: number;
  black: number;
  /** Side-to-move eval of the position (Lichess eval DB / Stockfish), if known. */
  cp: number | null;
  depth: number | null;
  /** Most-played first. Moves under 2 games are omitted (still in the totals). */
  moves: BookMove[];
}

/** One D1 / SQLite row as stored. */
export interface BookRow {
  tier: number;
  w: number;
  d: number;
  b: number;
  cp: number | null;
  depth: number | null;
  /** JSON: [[uci, san, w, d, b, titled, cp|null, 1|0|null], ...] */
  moves: string;
}

/** Same shape check as the old explorer proxy — rejects anything not FEN-like. */
export const FEN_RE =
  /^[1-8pnbrqkPNBRQK/]{15,71} [wb] [KQkq-]{1,4} [a-h1-8-]{1,2} \d{1,3} \d{1,4}$/;

/** FEN minus the halfmove/fullmove counters. Mirrors `epdOf` in openingDeviation.ts. */
export function bookEpd(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

/**
 * D1 key: the first 53 bits of SHA-1(epd), so it survives JS number
 * precision (D1 returns INTEGER as a JS number). Must equal `epd_key` in
 * tools/book-builder/src/book.rs.
 */
export async function bookKey(epd: string): Promise<number> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-1', new TextEncoder().encode(epd)),
  );
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(digest[i]);
  return Number(v >> 11n);
}

export function rowToPosition(row: BookRow): BookPosition {
  const raw = JSON.parse(row.moves) as [
    string,
    string,
    number,
    number,
    number,
    number,
    number | null,
    number | null,
  ][];
  return {
    tier: BOOK_TIER_BY_ID[row.tier] ?? 'otb',
    white: row.w,
    draws: row.d,
    black: row.b,
    cp: row.cp,
    depth: row.depth,
    moves: raw.map(([uci, san, white, draws, black, titled, cp, sound]) => ({
      uci,
      san,
      white,
      draws,
      black,
      titled,
      cp,
      sound: sound == null ? null : sound === 1,
    })),
  };
}

/**
 * Pick the tier that answers for one position: OTB when it has enough games,
 * else Elite, else whatever OTB has.
 */
export function pickTier(rows: BookRow[]): BookRow | null {
  const otb = rows.find((r) => r.tier === 0) ?? null;
  const elite = rows.find((r) => r.tier === 1) ?? null;
  if (otb && otb.w + otb.d + otb.b >= BOOK_OTB_MIN_GAMES) return otb;
  return elite ?? otb;
}

/** Validate a request body; returns the distinct FENs or an error message. */
export function parseBookRequest(body: unknown): string[] | string {
  const fens = (body as { fens?: unknown } | null)?.fens;
  if (!Array.isArray(fens) || fens.length === 0) return 'fens must be a non-empty array';
  if (fens.length > BOOK_MAX_FENS) return `at most ${BOOK_MAX_FENS} fens`;
  if (!fens.every((f): f is string => typeof f === 'string' && FEN_RE.test(f))) return 'bad fen';
  return [...new Set(fens)];
}

/** Response body: EPD → position; EPDs not in the book are omitted. */
export type BookResponse = { positions: Record<string, BookPosition> };
