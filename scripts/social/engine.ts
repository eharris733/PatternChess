// Engine checks with native Stockfish (brew install stockfish locally,
// apt-get install stockfish in CI).
//
// blunder format: a public puzzle with two winning moves gets "but Qh5 also
// wins" comments, so a position goes out only when the stored best move is
// still the engine's best and the second-best move is clearly worse.
//
// fall format: the tempting move must really lose (≥ MIN_TRAP_DROP winning
// chances against the best move), and the engine's line after it is the
// punishment the video plays out.
import { spawn } from 'node:child_process';
import { Chess } from 'chess.js';
import { winPercent } from '../../src/chess/winningChances.ts';
import { MATE_THRESHOLD } from './puzzle.ts';

export const MOVETIME_MS = 4000;
/** Best must leave the mover at least this likely to win… */
export const MIN_BEST_WIN = 75;
/** …and the runner-up must be at least this many winning-chance points worse. */
export const MIN_GAP = 30;
/** A "would you fall for this?" move must throw away at least this many winning-chance points. */
export const MIN_TRAP_DROP = 30;

export interface Line {
  move: string;
  /** Centipawns from the side to move; mates mapped to ±(10000 − n) like the app stores them. */
  cp: number;
  /** The principal variation (starts with `move`). */
  pv?: string[];
}

export function parseInfo(line: string): { multipv: number; depth: number; line: Line } | null {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return null;
  const mpv = /\bmultipv (\d+)/.exec(line);
  const depth = /\bdepth (\d+)/.exec(line);
  const cp = /\bscore cp (-?\d+)/.exec(line);
  const mate = /\bscore mate (-?\d+)/.exec(line);
  const pv = / pv (.+)$/.exec(line);
  if (!pv || (!cp && !mate) || / (lowerbound|upperbound)\b/.test(line)) return null;
  const score = cp
    ? Number(cp[1])
    : Number(mate![1]) > 0
      ? 10000 - Number(mate![1])
      : -10000 - Number(mate![1]);
  const moves = pv[1].trim().split(/\s+/);
  return { multipv: mpv ? Number(mpv[1]) : 1, depth: depth ? Number(depth[1]) : 0, line: { move: moves[0], cp: score, pv: moves } };
}

/** The engine's top `multipv` lines for the side to move. */
export function analyse(fen: string, multipv = 2, movetimeMs = MOVETIME_MS): Promise<Line[]> {
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
          resolve(Array.from({ length: multipv }, (_, i) => best[i + 1]).filter(Boolean));
        }
      }
    });
    sf.stdin.write(
      ['uci', 'setoption name Threads value 2', 'setoption name Hash value 128', `setoption name MultiPV value ${multipv}`, 'ucinewgame', `position fen ${fen}`, `go movetime ${movetimeMs}`]
        .map((c) => `${c}\n`)
        .join(''),
    );
  });
}

/** Top two moves for the side to move. */
export function topTwo(fen: string, movetimeMs = MOVETIME_MS): Promise<Line[]> {
  return analyse(fen, 2, movetimeMs);
}

export type Verdict = { ok: true; lines: Line[] } | { ok: false; reason: string; lines: Line[] };

const win = (cp: number) => (cp >= MATE_THRESHOLD ? 100 : cp <= -MATE_THRESHOLD ? 0 : winPercent(cp));

/** Pure rule over the engine's two lines (unit-tested). */
export function judge(expectedBest: string, lines: Line[]): Verdict {
  const [a, b] = lines;
  if (!a) return { ok: false, reason: 'engine returned no line', lines };
  if (a.move !== expectedBest) return { ok: false, reason: `engine prefers ${a.move} over ${expectedBest}`, lines };
  const bestWin = win(a.cp);
  if (bestWin < MIN_BEST_WIN) return { ok: false, reason: `best move only ${bestWin.toFixed(0)}% to win`, lines };
  if (!b) return { ok: true, lines }; // a single legal move: unique by definition
  if (a.cp >= MATE_THRESHOLD && b.cp >= MATE_THRESHOLD) return { ok: false, reason: `two mating moves (${b.move})`, lines };
  const secondWin = win(b.cp);
  if (bestWin - secondWin < MIN_GAP) {
    return { ok: false, reason: `${b.move} also works (${secondWin.toFixed(0)}% vs ${bestWin.toFixed(0)}%)`, lines };
  }
  return { ok: true, lines };
}

export async function verifyPuzzle(fen: string, expectedBest: string): Promise<Verdict> {
  return judge(expectedBest, await topTwo(fen));
}

export type TrapVerdict =
  | { ok: true; best: Line; refutation: Line }
  | { ok: false; reason: string };

/**
 * Pure rule for the fall format. `best` is the engine's top line in the
 * position; `refutation` is its top line after the tempting move, scored for
 * the opponent (so the mover's score is −refutation.cp).
 */
export function judgeTrap(tempting: string, best: Line | undefined, refutation: Line | undefined): TrapVerdict {
  if (!best || !refutation) return { ok: false, reason: 'engine returned no line' };
  if (best.move === tempting) return { ok: false, reason: `${tempting} is the engine's best move` };
  const drop = win(best.cp) - win(-refutation.cp);
  if (drop < MIN_TRAP_DROP) return { ok: false, reason: `${tempting} only drops ${drop.toFixed(0)} points` };
  if (!refutation.pv?.length) return { ok: false, reason: 'no refutation line' };
  return { ok: true, best, refutation };
}

export async function verifyTrap(fen: string, tempting: string): Promise<TrapVerdict> {
  const chess = new Chess(fen);
  try {
    chess.move({ from: tempting.slice(0, 2), to: tempting.slice(2, 4), promotion: tempting[4] || undefined });
  } catch {
    return { ok: false, reason: `${tempting} is illegal here` };
  }
  if (chess.isGameOver()) return { ok: false, reason: 'game over after the move' };
  const [best] = await analyse(fen, 1);
  const [refutation] = await analyse(chess.fen(), 1);
  return judgeTrap(tempting, best, refutation);
}

/**
 * One long-lived Stockfish for many quick searches (the pro scanner screens
 * every position of a game; a fresh process per position costs more than the
 * search itself). Calls run one at a time; close() when done.
 */
export class EngineSession {
  private sf = spawn(process.env.STOCKFISH_PATH ?? 'stockfish', [], { stdio: ['pipe', 'pipe', 'inherit'] });
  private buf = '';
  private waiting: ((line: string) => void) | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor() {
    this.sf.stdout.on('data', (chunk: Buffer) => {
      this.buf += chunk.toString();
      let nl: number;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const l = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        this.waiting?.(l);
      }
    });
    this.sf.stdin.write(['uci', 'setoption name Threads value 2', 'setoption name Hash value 128', 'isready'].map((c) => `${c}\n`).join(''));
  }

  analyse(fen: string, multipv = 1, movetimeMs = 150): Promise<Line[]> {
    const run = () =>
      new Promise<Line[]>((resolve, reject) => {
        const best: Record<number, Line> = {};
        const timer = setTimeout(() => {
          this.waiting = null;
          reject(new Error('stockfish timed out'));
        }, movetimeMs + 15_000);
        this.waiting = (l) => {
          const info = parseInfo(l);
          if (info) best[info.multipv] = info.line;
          if (l.startsWith('bestmove')) {
            clearTimeout(timer);
            this.waiting = null;
            resolve(Array.from({ length: multipv }, (_, i) => best[i + 1]).filter(Boolean));
          }
        };
        this.sf.stdin.write(`setoption name MultiPV value ${multipv}\nposition fen ${fen}\ngo movetime ${movetimeMs}\n`);
      });
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  close(): void {
    this.sf.stdin.end('quit\n');
  }
}
