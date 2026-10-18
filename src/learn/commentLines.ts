import { Chess } from 'chess.js';

/**
 * Finds move sequences written in a lesson comment ("1.e4 c5 2.Nf3",
 * "...Nxc3 bxc3 Bf8", "Qg4") so the player can make them clickable. A run of
 * move-shaped words counts only when it is legal from one of the candidate
 * positions (the current board first, then earlier ones), so a square name in
 * prose ("c3 isn't hanging") stays text. A lone pawn move like "e5" needs a
 * move number or "..." in front, or a second move after it, for the same
 * reason.
 */

export interface CommentLine {
  /** Position the line starts from. */
  fen: string;
  moves: Array<{ san: string; uci: string; fen: string }>;
}

export type CommentSegment = { text: string; line?: CommentLine };

const SAN = /^(O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?[1-8](?:=[QRBN])?)[+#]?[!?]{0,2}$/;
const NUMBER = /^(\d+)(\.{1,3})$/;

interface Token {
  start: number;
  end: number;
  san: string;
  /** "7." → white's 7th move, "7..." / "..." → black's. */
  number?: { move: number | null; black: boolean };
}

/** A move word, with any "7." / "7..." / "..." glued to it, and its trailing punctuation dropped. */
function moveToken(word: string, start: number): Token | null {
  const m = /^(?:(\d+)?(\.{1,3}))?(.+?)[,.;:)]*$/.exec(word);
  if (!m || !SAN.test(m[3])) return null;
  const lead = word.indexOf(m[3]);
  const t: Token = { start: start + (m[2] ? 0 : lead), end: start + lead + m[3].length, san: m[3] };
  if (m[2]) t.number = { move: m[1] ? Number(m[1]) : null, black: m[2].length === 3 };
  return t;
}

function play(fen: string, tokens: Token[]): CommentLine | null {
  const chess = new Chess(fen);
  const first = tokens[0].number;
  if (first) {
    const [, side, , , , full] = fen.split(' ');
    if ((side === 'b') !== first.black) return null;
    if (first.move != null && Number(full) !== first.move) return null;
  }
  const moves: CommentLine['moves'] = [];
  for (const t of tokens) {
    try {
      const m = chess.move(t.san.replace(/[!?]+$/, ''));
      moves.push({ san: m.san, uci: `${m.from}${m.to}${m.promotion ?? ''}`, fen: chess.fen() });
    } catch {
      return null;
    }
  }
  return { fen, moves };
}

export function splitCommentLines(text: string, candidates: string[]): CommentSegment[] {
  // Words with their offsets; a bare "7." / "7..." word attaches to the next move.
  const words = [...text.matchAll(/\S+/g)].map((m) => ({ word: m[0], start: m.index! }));
  const runs: Token[][] = [];
  let run: Token[] = [];
  let pendingNumber: { start: number; move: number; black: boolean } | null = null;
  const flush = () => {
    if (run.length > 0) runs.push(run);
    run = [];
  };
  for (const { word, start } of words) {
    const num = NUMBER.exec(word);
    if (num) {
      pendingNumber = { start, move: Number(num[1]), black: num[2].length === 3 };
      continue;
    }
    const t = moveToken(word, start);
    if (!t) {
      pendingNumber = null;
      flush();
      continue;
    }
    if (pendingNumber && !t.number) {
      t.number = { move: pendingNumber.move, black: pendingNumber.black };
      t.start = pendingNumber.start;
    }
    pendingNumber = null;
    run.push(t);
    // Prose punctuation after a move ends the run ("Qg4, and ...", "takes on e4.").
    if (/[,.;:)]$/.test(word)) flush();
  }
  flush();

  const segments: CommentSegment[] = [];
  let at = 0;
  for (const r of runs) {
    const lonePawn = r.length === 1 && !r[0].number && /^[a-h][1-8]$/.test(r[0].san);
    if (lonePawn) continue;
    let line: CommentLine | null = null;
    for (const fen of candidates) {
      line = play(fen, r);
      if (line) break;
    }
    if (!line) continue;
    const start = r[0].start;
    const end = r.at(-1)!.end;
    if (start > at) segments.push({ text: text.slice(at, start) });
    segments.push({ text: text.slice(start, end), line });
    at = end;
  }
  if (at < text.length) segments.push({ text: text.slice(at) });
  return segments;
}
