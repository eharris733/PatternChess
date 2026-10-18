import { Chess } from 'chess.js';
import type { DrawShape } from 'chessground/draw';
import type { LearnChapter, LearnNode } from '../models/learn';

/**
 * Lichess study PGN → LearnChapter move trees. Runs at build time only
 * (scripts/build-learn.ts) on the output of @mliebelt/pgn-parser, so no PGN
 * parser ships to the browser. Every move is replayed through chess.js, which
 * validates the study and gives each node its FEN and UCI.
 *
 * The parser types are mirrored structurally here (only what we read) so this
 * module has no dependency on the parser package.
 */

export interface ParsedDiag {
  comment?: string;
  colorArrows?: string[];
  colorFields?: string[];
  /** `[%ts m:ss]` — our own command: where in the source video this moment is. */
  ts?: string;
}

export interface ParsedMove {
  notation: { notation: string };
  commentAfter?: string;
  commentDiag?: ParsedDiag | null;
  nag?: string[] | null;
  variations: ParsedMove[][];
}

export interface ParsedGame {
  tags?: Record<string, unknown>;
  gameComment?: ParsedDiag | null;
  moves: ParsedMove[];
}

const STANDARD_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const BRUSH: Record<string, string> = { G: 'green', R: 'red', Y: 'yellow', B: 'blue' };

/** "Gd3d4" arrows and "Ge2" highlights → chessground shapes. */
export function shapesFromDiag(diag: ParsedDiag | null | undefined): DrawShape[] {
  const out: DrawShape[] = [];
  for (const a of diag?.colorArrows ?? []) {
    const m = /^([GRYB])([a-h][1-8])([a-h][1-8])$/.exec(a);
    if (m) out.push({ orig: m[2] as DrawShape['orig'], dest: m[3] as DrawShape['orig'], brush: BRUSH[m[1]] });
  }
  for (const f of diag?.colorFields ?? []) {
    const m = /^([GRYB])([a-h][1-8])$/.exec(f);
    if (m) out.push({ orig: m[2] as DrawShape['orig'], brush: BRUSH[m[1]] });
  }
  return out;
}

/**
 * Prose only: drop any Lichess command the parser left in ([%clk], [%eval],
 * [%anno ...], [%emt] ...) and collapse whitespace.
 */
export function cleanComment(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const text = raw
    .replace(/\[%[a-z]+[^\]]*\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0 ? text : undefined;
}

/** "4:12" / "1:02:03" → seconds. */
export function parseTimestamp(raw: string | null | undefined): number | undefined {
  if (!raw || !/^\d+(:\d{1,2}){1,2}$/.test(raw.trim())) return undefined;
  return raw
    .trim()
    .split(':')
    .reduce((acc, part) => acc * 60 + Number(part), 0);
}

function nagsOf(nag: string[] | null | undefined): number[] | undefined {
  // "?!" and "$6" on the same move both parse to $6.
  const out = [
    ...new Set(
      (nag ?? []).map((n) => Number(n.replace('$', ''))).filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];
  return out.length > 0 ? out : undefined;
}

export class StudyMoveError extends Error {}

/**
 * Build the alternatives available at `fen` from a parsed line starting at
 * `moves[idx]`: the line's own move first (it continues that line), then each
 * variation attached to it. Ids are sequential per chapter.
 */
function buildAlternatives(
  moves: ParsedMove[],
  idx: number,
  fen: string,
  nextId: () => string,
): LearnNode[] {
  if (idx >= moves.length) return [];
  const m = moves[idx];
  const chess = new Chess(fen);
  let played;
  try {
    played = chess.move(m.notation.notation);
  } catch {
    throw new StudyMoveError(`illegal move ${m.notation.notation} at ${fen}`);
  }
  const node: LearnNode = {
    id: nextId(),
    san: played.san,
    uci: `${played.from}${played.to}${played.promotion ?? ''}`,
    fen: chess.fen(),
    children: [],
  };
  const comment = cleanComment(m.commentDiag?.comment ?? m.commentAfter);
  if (comment) node.comment = comment;
  const shapes = shapesFromDiag(m.commentDiag);
  if (shapes.length > 0) node.shapes = shapes;
  const nags = nagsOf(m.nag);
  if (nags) node.nags = nags;
  const ts = parseTimestamp(m.commentDiag?.ts);
  if (ts != null) node.ts = ts;
  node.children = buildAlternatives(moves, idx + 1, node.fen, nextId);

  const alts: LearnNode[] = [node];
  for (const variation of m.variations ?? []) {
    for (const alt of buildAlternatives(variation, 0, fen, nextId)) {
      // A variation can repeat the main move; keep the first copy.
      if (!alts.some((a) => a.uci === alt.uci)) alts.push(alt);
    }
  }
  return alts;
}

function tag(game: ParsedGame, name: string): string | null {
  const v = game.tags?.[name];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/** Lichess annotator tags are profile URLs; show the handle. */
function annotatorName(raw: string | null): string | null {
  if (!raw) return null;
  const m = /lichess\.org\/@\/([^/?#\s]+)/.exec(raw);
  return m ? m[1] : raw;
}

/** EPD (placement, side, castling, en passant) for comparing positions. */
const epd = (fen: string) => fen.split(' ').slice(0, 4).join(' ');

/**
 * `[LeadIn "1.e4 c5 2.Nf3"]` → the moves from the initial position. They must
 * reach the chapter's start position (when the chapter sets one).
 */
function leadInFromTag(raw: string, startFen: string | null): NonNullable<LearnChapter['leadIn']> {
  const chess = new Chess();
  const out: NonNullable<LearnChapter['leadIn']> = [];
  for (const token of raw.split(/\s+/)) {
    const san = token.replace(/^\d+\.+/, '');
    if (!san || san === '*') continue;
    let played;
    try {
      played = chess.move(san);
    } catch {
      throw new StudyMoveError(`illegal lead-in move ${token} at ${chess.fen()}`);
    }
    out.push({ san: played.san, uci: `${played.from}${played.to}${played.promotion ?? ''}`, fen: chess.fen() });
  }
  if (startFen && epd(chess.fen()) !== epd(startFen)) {
    throw new StudyMoveError(`lead-in "${raw}" reaches ${chess.fen()}, not the chapter start ${startFen}`);
  }
  return out;
}

/** One parsed study game → chapter. Throws StudyMoveError on an illegal move. */
export function chapterFromGame(game: ParsedGame, fallbackIndex: number): LearnChapter {
  const url = tag(game, 'ChapterURL') ?? '';
  const id = url.split('/').filter(Boolean).pop() ?? `chapter-${fallbackIndex + 1}`;
  const leadInTag = tag(game, 'LeadIn');
  const leadIn = leadInTag ? leadInFromTag(leadInTag, tag(game, 'FEN')) : undefined;
  const startFen = tag(game, 'FEN') ?? leadIn?.at(-1)?.fen ?? STANDARD_FEN;
  let n = 0;
  const nextId = () => `n${n++}`;
  const chapter: LearnChapter = {
    id,
    name: tag(game, 'ChapterName') ?? `Chapter ${fallbackIndex + 1}`,
    url,
    annotator: annotatorName(tag(game, 'Annotator')),
    orientation: tag(game, 'Orientation') === 'black' ? 'black' : 'white',
    startFen,
    gamebook: tag(game, 'ChapterMode') === 'gamebook',
    moves: buildAlternatives(game.moves ?? [], 0, startFen, nextId),
  };
  const intro = cleanComment(game.gameComment?.comment);
  if (intro) chapter.intro = intro;
  const introShapes = shapesFromDiag(game.gameComment);
  if (introShapes.length > 0) chapter.introShapes = introShapes;
  const introTs = parseTimestamp(game.gameComment?.ts);
  if (introTs != null) chapter.introTs = introTs;
  if (leadIn && leadIn.length > 0) chapter.leadIn = leadIn;
  return chapter;
}

/** Standard-chess chapters only: the board and chess.js can't play variants. */
export function isStandardChapter(game: ParsedGame): boolean {
  const variant = tag(game, 'Variant');
  return variant == null || /^(standard|from position)$/i.test(variant);
}
