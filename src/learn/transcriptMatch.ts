// Ties a lesson note to what the creator actually says at its [%ts] moment.
// Used by scripts/check-course.ts (and scripts/course-video.ts for clocks):
// a note passes when the transcript around its timestamp names at least one
// of the squares the note names, or (for notes without squares) shares enough
// of its content words. Pure, so it is unit-tested.

export interface TranscriptSegment {
  /** Seconds from the start of the video. */
  start: number;
  end: number;
  text: string;
}

export interface NoteMatch {
  ok: boolean;
  /** Tokens the note names that the transcript window also has. */
  matched: string[];
  /** Tokens the check looked for. */
  wanted: string[];
  /** The transcript around the timestamp, for the review report. */
  excerpt: string;
}

/** "m:ss" | "h:mm:ss" | plain seconds → seconds. */
export function parseClock(s: string): number {
  const t = s.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const parts = t.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) throw new Error(`bad time "${s}"`);
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const SQUARE = /\b([a-h][1-8])\b/gi;
const PIECE_WORDS: Record<string, string> = { N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' };
const STOP = new Set(
  'about after again against already also always another because before being black better between cannot could doesn every first going great having here into just know later light little looks maybe might move moves much never other piece pieces place play played player playing position really right should since something still taking thing things think those three through today under until where which while white with without would youre your'.split(
    ' ',
  ),
);

/** Lowercase, collapse "e 4" → "e4", drop punctuation. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b([a-h])\s+([1-8])\b/g, '$1$2')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Squares the note names, from prose and SAN alike ("Nxe4", "...d5", "e4"). */
export function noteSquares(note: string): string[] {
  const out = new Set<string>();
  for (const m of note.matchAll(/[KQRBN]?[a-h]?[1-8]?x?([a-h][1-8])(?:=[QRBN])?[+#]?/g)) out.add(m[1].toLowerCase());
  for (const m of note.matchAll(SQUARE)) out.add(m[1].toLowerCase());
  return [...out];
}

function contentWords(text: string): string[] {
  const words = normalize(text)
    .split(' ')
    .filter((w) => w.length >= 5 && !STOP.has(w) && !/^[a-h][1-8]$/.test(w));
  return [...new Set(words)];
}

/** Transcript text between `from` and `to` seconds. */
export function windowText(segs: TranscriptSegment[], from: number, to: number): string {
  return segs
    .filter((s) => s.end >= from && s.start <= to)
    .map((s) => s.text)
    .join(' ');
}

/**
 * Does the transcript within ±`windowS` seconds of `ts` back up `note`?
 * Notes naming squares need one of those squares spoken nearby (pieces add
 * nothing on their own: "knight" is said everywhere). Notes without squares
 * need two of their content words (≥ 5 letters), or one when they have one.
 */
export function matchNote(note: string, ts: number, segs: TranscriptSegment[], windowS = 45): NoteMatch {
  const near = normalize(windowText(segs, ts - windowS, ts + windowS));
  const nearWords = new Set(near.split(' '));
  const excerpt = windowText(segs, ts - 5, ts + 25).replace(/\s+/g, ' ').slice(0, 280);
  const squares = noteSquares(note);
  if (squares.length) {
    const matched = squares.filter((sq) => nearWords.has(sq));
    return { ok: matched.length > 0, matched, wanted: squares, excerpt };
  }
  const words = contentWords(note);
  // Pieces only count when the note has nothing else to go on.
  const pieces = Object.values(PIECE_WORDS).filter((p) => new RegExp(`\\b${p}`, 'i').test(note));
  const wanted = words.length ? words : pieces;
  const matched = wanted.filter((w) => nearWords.has(w) || nearWords.has(`${w}s`) || (w.endsWith('s') && nearWords.has(w.slice(0, -1))));
  const need = Math.min(2, wanted.length);
  return { ok: wanted.length === 0 || matched.length >= need, matched, wanted, excerpt };
}

const FILLER_WORDS = new Set(
  'a an and the to on in at of it its is so now then say says plays play played goes go comes come back again first next takes take took captures capture recaptures check checks castles castle moves move here there this that with white black king queen rook bishop knight pawn pawns piece main most common continuation option other instead also line answer reply replies retreats retreat up down round'.split(
    ' ',
  ),
);

/**
 * A note that only names the move ("Knight to f3.", "...Ke7.", "White castles.").
 * On an opponent move every note is a pause the learner has to click through,
 * so these are dropped rather than shown.
 */
export function isFillerNote(note: string): boolean {
  const words = note
    .replace(/\[%[^\]]*\]/g, ' ')
    .replace(/\b\d+\.+/g, ' ')
    .replace(/\b[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?[+#]?/g, ' ')
    .replace(/O-O(-O)?/g, ' ')
    .toLowerCase()
    .replace(/[^a-z\s']/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !FILLER_WORDS.has(w));
  return words.length === 0;
}

/**
 * Is `token` (a square like "g7", or a word like "castle") spoken between
 * `from` and `to` seconds? Squares match the transcript's "g 7" spelling too.
 */
export function spokenBetween(segs: TranscriptSegment[], from: number, to: number, token: string): boolean {
  const words = new Set(normalize(windowText(segs, from, to)).split(' '));
  if (words.has(token)) return true;
  // "castles" / "castling" for "castle".
  return [...words].some((w) => w.length > token.length && w.startsWith(token) && !/^[a-h][1-8]$/.test(token));
}
