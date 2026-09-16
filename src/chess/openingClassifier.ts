import { Chess } from 'chess.js';

/**
 * Position-based opening classification.
 *
 * Platform PGN headers disagree about openings: lichess ships `[Opening ...]`
 * and an ECO code, chess.com ships only an ECO code plus an `ECOUrl` slug, and
 * the two sites assign different codes to the same game. Classifying from the
 * board instead gives every game one name whatever its source, and makes
 * transpositions land on the same opening.
 *
 * The book (`src/generated/openingBook.json`, built by
 * scripts/build-opening-book.mjs from the CC0 lichess-org/chess-openings data)
 * maps EPD → `"<eco>|<name>"`. It is ~429 KB, so it loads on demand as its own
 * chunk — never import the JSON directly from app code.
 */

export interface ClassifiedOpening {
  /** ECO code of the deepest matched book line, e.g. "B90". */
  eco: string;
  /** Full opening name, e.g. "Sicilian Defense: Najdorf Variation". */
  name: string;
  /** Grouping key: the name up to the first colon, e.g. "Sicilian Defense". */
  family: string;
}

export interface OpeningBook {
  version: number;
  /** Deepest line in the book; walking past it can never match. */
  maxPlies: number;
  entries: Record<string, string>;
}

/**
 * Games shorter than this are aborts and scratch games (a large share of
 * synced history), not openings worth counting — they classify as null.
 */
export const MIN_CLASSIFY_PLIES = 4;

let bookPromise: Promise<OpeningBook> | null = null;

/** Load (and cache) the opening book chunk. */
export async function loadOpeningBook(): Promise<OpeningBook> {
  bookPromise ??= import('../generated/openingBook.json').then(
    (m) => (m.default ?? m) as unknown as OpeningBook,
  );
  return bookPromise;
}

/** The family a full opening name belongs to ("Sicilian Defense: Najdorf" → "Sicilian Defense"). */
export function openingFamilyOf(name: string): string {
  const head = name.split(':')[0]?.trim();
  return head && head.length > 0 ? head : name.trim();
}

/** FEN minus the halfmove/fullmove counters — the key the book is built on. */
function epdOf(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

function parseEntry(value: string): ClassifiedOpening | null {
  const sep = value.indexOf('|');
  if (sep < 0) return null;
  const eco = value.slice(0, sep);
  const name = value.slice(sep + 1);
  if (!eco || !name) return null;
  return { eco, name, family: openingFamilyOf(name) };
}

/**
 * Classify a move list against an already-loaded book. The deepest matching
 * position wins, and the walk continues past a miss so a line that leaves the
 * book and transposes back still resolves to the deeper opening.
 */
export function classifyMoves(
  book: OpeningBook,
  sanMoves: string[],
): ClassifiedOpening | null {
  if (sanMoves.length < MIN_CLASSIFY_PLIES) return null;
  const board = new Chess();
  let best: string | null = null;
  const limit = Math.min(sanMoves.length, book.maxPlies);
  for (let i = 0; i < limit; i++) {
    try {
      board.move(sanMoves[i]);
    } catch {
      break; // Malformed or illegal continuation — keep whatever matched so far.
    }
    const hit = book.entries[epdOf(board.fen())];
    if (hit) best = hit;
  }
  return best ? parseEntry(best) : null;
}

/** SAN move list for a PGN, or null when it can't be replayed. */
export function movesFromPgn(pgn: string): string[] | null {
  const board = new Chess();
  try {
    board.loadPgn(pgn);
  } catch {
    return null;
  }
  return board.history();
}

/** Classify a PGN against an already-loaded book (batch callers: load once, reuse). */
export function classifyPgnWithBook(
  book: OpeningBook,
  pgn: string,
): ClassifiedOpening | null {
  const moves = movesFromPgn(pgn);
  if (!moves || moves.length < MIN_CLASSIFY_PLIES) return null;
  return classifyMoves(book, moves);
}

/** Classify a single PGN, loading the book on first use. */
export async function classifyPgn(pgn: string): Promise<ClassifiedOpening | null> {
  const moves = movesFromPgn(pgn);
  if (!moves || moves.length < MIN_CLASSIFY_PLIES) return null;
  const book = await loadOpeningBook();
  return classifyMoves(book, moves);
}
