// One-answer check with native Stockfish (brew install stockfish locally,
// apt-get install stockfish in CI). A public puzzle with two winning moves
// gets "but Qh5 also wins" comments, so a position goes out only when the
// stored best move is still the engine's best and the second-best move is
// clearly worse.
import { spawn } from 'node:child_process';
import { winPercent } from '../../src/chess/winningChances.ts';
import { MATE_THRESHOLD } from './puzzle.ts';

export const MOVETIME_MS = 4000;
/** Best must leave the mover at least this likely to win… */
export const MIN_BEST_WIN = 75;
/** …and the runner-up must be at least this many winning-chance points worse. */
export const MIN_GAP = 30;

export interface Line {
  move: string;
  /** Centipawns from the side to move; mates mapped to ±(10000 − n) like the app stores them. */
  cp: number;
}

export function parseInfo(line: string): { multipv: number; depth: number; line: Line } | null {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return null;
  const mpv = /\bmultipv (\d+)/.exec(line);
  const depth = /\bdepth (\d+)/.exec(line);
  const cp = /\bscore cp (-?\d+)/.exec(line);
  const mate = /\bscore mate (-?\d+)/.exec(line);
  const pv = /\bpv (\S+)/.exec(line);
  if (!pv || (!cp && !mate) || / (lowerbound|upperbound)\b/.test(line)) return null;
  const score = cp
    ? Number(cp[1])
    : Number(mate![1]) > 0
      ? 10000 - Number(mate![1])
      : -10000 - Number(mate![1]);
  return { multipv: mpv ? Number(mpv[1]) : 1, depth: depth ? Number(depth[1]) : 0, line: { move: pv[1], cp: score } };
}

/** Top two moves for the side to move. */
export function topTwo(fen: string, movetimeMs = MOVETIME_MS): Promise<Line[]> {
  return new Promise((resolve, reject) => {
    const sf = spawn(process.env.STOCKFISH_PATH ?? 'stockfish', [], { stdio: ['pipe', 'pipe', 'inherit'] });
    const best: Record<number, Line> = {};
    let buf = '';
    const timer = setTimeout(() => {
      sf.kill();
      reject(new Error('stockfish timed out'));
    }, movetimeMs + 15_000);
    sf.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    sf.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        const info = parseInfo(l);
        if (info) best[info.multipv] = info.line;
        if (l.startsWith('bestmove')) {
          clearTimeout(timer);
          sf.stdin.end('quit\n');
          resolve([best[1], best[2]].filter(Boolean) as Line[]);
        }
      }
    });
    sf.stdin.write(
      ['uci', 'setoption name Threads value 2', 'setoption name Hash value 128', 'setoption name MultiPV value 2', 'ucinewgame', `position fen ${fen}`, `go movetime ${movetimeMs}`]
        .map((c) => `${c}\n`)
        .join(''),
    );
  });
}

export type Verdict = { ok: true; lines: Line[] } | { ok: false; reason: string; lines: Line[] };

/** Pure rule over the engine's two lines (unit-tested). */
export function judge(expectedBest: string, lines: Line[]): Verdict {
  const [a, b] = lines;
  if (!a) return { ok: false, reason: 'engine returned no line', lines };
  if (a.move !== expectedBest) return { ok: false, reason: `engine prefers ${a.move} over ${expectedBest}`, lines };
  const bestWin = a.cp >= MATE_THRESHOLD ? 100 : winPercent(a.cp);
  if (bestWin < MIN_BEST_WIN) return { ok: false, reason: `best move only ${bestWin.toFixed(0)}% to win`, lines };
  if (!b) return { ok: true, lines }; // a single legal move: unique by definition
  if (a.cp >= MATE_THRESHOLD && b.cp >= MATE_THRESHOLD) return { ok: false, reason: `two mating moves (${b.move})`, lines };
  const secondWin = b.cp >= MATE_THRESHOLD ? 100 : winPercent(b.cp);
  if (bestWin - secondWin < MIN_GAP) {
    return { ok: false, reason: `${b.move} also works (${secondWin.toFixed(0)}% vs ${bestWin.toFixed(0)}%)`, lines };
  }
  return { ok: true, lines };
}

export async function verifyPuzzle(fen: string, expectedBest: string): Promise<Verdict> {
  return judge(expectedBest, await topTwo(fen));
}
