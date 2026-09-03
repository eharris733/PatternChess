// UCI line parsers — verbatim port of lib/src/services/stockfish_service.dart parsers.

const SCORE_CP_RE = /score cp (-?\d+)/;
const SCORE_MATE_RE = /score mate (-?\d+)/;

/** Reverse-walk lines, return the most recent score in centipawns (mate mapped to ±10000-N). */
export function parseEvalCp(output: string): number {
  const lines = output.split('\n').reverse();
  for (const line of lines) {
    if (line.includes('score cp')) {
      const m = SCORE_CP_RE.exec(line);
      if (m) return Number.parseInt(m[1], 10);
    }
    if (line.includes('score mate')) {
      const m = SCORE_MATE_RE.exec(line);
      if (m) {
        const mateIn = Number.parseInt(m[1], 10);
        return mateIn > 0 ? 10000 - mateIn : -10000 + Math.abs(mateIn);
      }
    }
  }
  return 0;
}

/** Best move UCI, or '' when absent — including `bestmove (none)` at terminal positions. */
export function parseBestMove(output: string): string {
  const lines = output.split('\n').reverse();
  for (const line of lines) {
    if (line.startsWith('bestmove ')) {
      const parts = line.split(' ');
      if (parts.length >= 2) return parts[1] === '(none)' ? '' : parts[1];
    }
  }
  return '';
}

const DEPTH_RE = /\bdepth (\d+)/;

/**
 * Deepest completed search depth in the output, or null when none was
 * reported (e.g. instant `bestmove` at a terminal position). Only lines
 * carrying a score count — `info depth N currmove …` progress lines report
 * an iteration that hasn't completed. Depth is non-decreasing within one
 * search, so the reverse walk finds the deepest. (`seldepth` can't match:
 * `\b` requires a non-word char before `depth`.)
 */
export function parseDepth(output: string): number | null {
  const lines = output.split('\n').reverse();
  for (const line of lines) {
    if (!line.includes(' score ')) continue;
    const m = DEPTH_RE.exec(line);
    if (m) return Number.parseInt(m[1], 10);
  }
  return null;
}

export function parsePrincipalVariation(output: string, maxMoves = 5): string[] {
  const lines = output.split('\n').reverse();
  for (const line of lines) {
    const idx = line.indexOf(' pv ');
    if (idx >= 0) {
      const pvStr = line.slice(idx + 4).trim();
      const moves = pvStr.split(/\s+/);
      return moves.slice(0, maxMoves);
    }
  }
  return [];
}

export interface InfoLine {
  /** Iteration depth the score belongs to. */
  depth: number;
  /** Side-to-move score in centipawns (mate mapped to ±10000-N like parseEvalCp). */
  cp: number;
  /** True for fail-high/fail-low iterations (`lowerbound`/`upperbound`) — not a settled score. */
  bound: boolean;
}

/**
 * Parse one streamed `info … score …` line. Returns null for lines that carry
 * no score (currmove progress, string lines, bestmove). Used by the
 * early-stop rule in `evaluateSmart`, which needs to see scores as they land
 * rather than after the search finishes.
 */
export function parseInfoLine(line: string): InfoLine | null {
  if (!line.startsWith('info ') || !line.includes(' score ')) return null;
  const d = DEPTH_RE.exec(line);
  if (!d) return null;
  let cp: number;
  const cpMatch = SCORE_CP_RE.exec(line);
  if (cpMatch) {
    cp = Number.parseInt(cpMatch[1], 10);
  } else {
    const mateMatch = SCORE_MATE_RE.exec(line);
    if (!mateMatch) return null;
    const mateIn = Number.parseInt(mateMatch[1], 10);
    cp = mateIn > 0 ? 10000 - mateIn : -10000 + Math.abs(mateIn);
  }
  return {
    depth: Number.parseInt(d[1], 10),
    cp,
    bound: / (?:lowerbound|upperbound)\b/.test(line),
  };
}
