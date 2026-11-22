#!/usr/bin/env node
// Engine-check every move of a course PGN before it ships.
//
//   npm run course:check -- content/courses/<slug>.pgn [--depth 22] [--report out.md]
//   npm run course:check -- --explore "e4 c5 Nf3"      # MultiPV 3 at a position, for authoring
//
// Native Stockfish (`brew install stockfish`; override with STOCKFISH=path).
// Grading, all in Lichess winning chances (src/chess/winningChances.ts):
//   - a move the learner plays (chapter orientation) fails above 5% lost vs
//     the engine's best — the same bar as the training accept rule — unless
//     the author marked it ?/??/?! (then it's a trap the drill rejects, and
//     we check it really is worse: at least 5% lost);
//   - an opponent move fails above 15% lost unless marked ?/??/?!;
//   - an unmarked learner sideline with no continuation is a "good move, now
//     find the main one" nudge in the drill, so it only has to be sound:
//     under 10% lost (classify() === 'good', the app's "Sound").
// At learner nodes, engine moves within 5% that the PGN doesn't list are
// printed so the author can add them as accepted alternatives.
// Exits 1 on any failure.

import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from '@mliebelt/pgn-parser';
import { Chess } from 'chess.js';
import { chapterFromGame, type ParsedGame } from '../src/learn/pgnToTree.ts';
import { classify, winningChancesLost } from '../src/chess/winningChances.ts';
import { BAD_MOVE_NAGS, type LearnNode } from '../src/models/learn.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DEPTH = Number(flag('--depth') ?? 22);
const ENGINE = process.env.STOCKFISH ?? '/opt/homebrew/bin/stockfish';
const LEARNER_MAX_LOSS = 5;
const OPPONENT_MAX_LOSS = 15;

interface Line {
  cp: number; // side-to-move POV, mate mapped to ±(10000 - n)
  uci: string;
}

class Engine {
  private proc: ChildProcess;
  private buf = '';
  private waiter: { until: RegExp; resolve: (s: string) => void } | null = null;
  private cache = new Map<string, Line[]>();

  constructor() {
    this.proc = spawn(ENGINE, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.proc.stdout!.on('data', (d) => {
      this.buf += d.toString();
      if (this.waiter && this.waiter.until.test(this.buf)) {
        const w = this.waiter;
        const out = this.buf;
        this.waiter = null;
        this.buf = '';
        w.resolve(out);
      }
    });
  }

  private send(cmd: string, until: RegExp): Promise<string> {
    return new Promise((resolve) => {
      this.waiter = { until, resolve };
      this.proc.stdin!.write(`${cmd}\n`);
    });
  }

  async init(): Promise<void> {
    await this.send('uci', /uciok/);
    this.proc.stdin!.write('setoption name Threads value 6\nsetoption name Hash value 512\nsetoption name MultiPV value 3\n');
    await this.send('isready', /readyok/);
  }

  /** Top lines at `fen`, best first. Terminal positions return []. */
  async lines(fen: string): Promise<Line[]> {
    const hit = this.cache.get(fen);
    if (hit) return hit;
    const out = await this.send(`position fen ${fen}\ngo depth ${DEPTH}`, /(^|\n)bestmove /);
    const best = new Map<number, Line>();
    for (const l of out.split('\n')) {
      const m = / depth (\d+) .*multipv (\d+) score (cp|mate) (-?\d+).* pv (\S+)/.exec(l);
      if (!m || Number(m[1]) !== DEPTH) continue;
      const v = Number(m[4]);
      const cp = m[3] === 'cp' ? v : v > 0 ? 10000 - v : -10000 - v;
      best.set(Number(m[2]), { cp, uci: m[5] });
    }
    const res = [...best.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l);
    this.cache.set(fen, res);
    return res;
  }

  /** Eval of `fen` from its side to move; terminal = mate/stalemate score. */
  async score(fen: string): Promise<number> {
    const chess = new Chess(fen);
    if (chess.isCheckmate()) return -10000;
    if (chess.isDraw() || chess.isStalemate()) return 0;
    return (await this.lines(fen))[0]?.cp ?? 0;
  }

  kill(): void {
    this.proc.kill();
  }
}

function san(fen: string, uci: string): string {
  const c = new Chess(fen);
  return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
}

const fmt = (cp: number) => (Math.abs(cp) >= 9000 ? `#${cp > 0 ? 10000 - cp : -(10000 + cp)}` : (cp / 100).toFixed(2));

async function explore(engine: Engine, moves: string) {
  const c = new Chess();
  for (const m of moves.split(/\s+/).filter(Boolean)) c.move(m.replace(/^\d+\.+/, ''));
  const fen = c.fen();
  const lines = await engine.lines(fen);
  console.log(fen);
  for (const l of lines) console.log(`  ${san(fen, l.uci).padEnd(7)} ${fmt(l.cp)}`);
}

interface Row {
  chapter: string;
  path: string;
  move: string;
  who: 'learner' | 'opponent';
  marked: boolean;
  loss: number;
  best: string;
  ok: boolean;
  note: string;
}

async function check(engine: Engine, pgnPath: string) {
  const games = parse(readFileSync(pgnPath, 'utf8'), { startRule: 'games' }) as unknown as ParsedGame[];
  const rows: Row[] = [];
  for (const [i, g] of games.entries()) {
    const ch = chapterFromGame(g, i);
    const walk = async (fen: string, nodes: LearnNode[], line: string[]) => {
      if (nodes.length === 0) return;
      const mover = fen.split(' ')[1] === 'w' ? 'white' : 'black';
      const who = mover === ch.orientation ? 'learner' : 'opponent';
      const top = await engine.lines(fen);
      const bestCp = top[0]?.cp ?? 0;
      const bestSan = top[0] ? san(fen, top[0].uci) : '-';
      for (const n of nodes) {
        const after = await engine.score(n.fen);
        const loss = Math.max(0, winningChancesLost(bestCp, after));
        const marked = (n.nags ?? []).some((x) => BAD_MOVE_NAGS.has(x));
        let ok: boolean;
        let note = '';
        if (marked) {
          ok = loss >= LEARNER_MAX_LOSS || who === 'opponent';
          if (!ok) note = 'marked bad but engine finds it fine';
        } else if (who === 'learner' && n !== nodes[0] && n.children.length === 0) {
          ok = classify(loss) === 'good';
          if (!ok) note = `nudged as a good move but loses ${loss.toFixed(1)}%`;
        } else {
          ok = loss <= (who === 'learner' ? LEARNER_MAX_LOSS : OPPONENT_MAX_LOSS);
          if (!ok) note = `loses ${loss.toFixed(1)}%`;
        }
        rows.push({
          chapter: ch.name,
          path: [...line, n.san].join(' '),
          move: n.san,
          who,
          marked,
          loss,
          best: `${bestSan} ${fmt(bestCp)}`,
          ok,
          note,
        });
        await walk(n.fen, n.children, [...line, n.san]);
      }
      if (who === 'learner') {
        const listed = new Set(nodes.map((n) => n.uci));
        for (const l of top) {
          if (listed.has(l.uci)) continue;
          if (winningChancesLost(bestCp, -l.cp) <= LEARNER_MAX_LOSS) {
            const s = san(fen, l.uci);
            console.log(`  ~ ${ch.name}: after "${line.join(' ') || 'start'}", ${s} (${fmt(l.cp)}) is also within 5% — accept it?`);
          }
        }
      }
    };
    await walk(ch.startFen, ch.moves, []);
  }
  const failed = rows.filter((r) => !r.ok);
  const md = [
    `# Engine report: ${pgnPath}`,
    '',
    `Stockfish depth ${DEPTH}. Learner moves must stay within ${LEARNER_MAX_LOSS}% winning chances of best; opponent moves within ${OPPONENT_MAX_LOSS}% unless marked ?/??/?!.`,
    '',
    '| Chapter | Line | Side | Lost | Engine best | Result |',
    '|---|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.chapter} | ${r.path}${r.marked ? ' (marked bad)' : ''} | ${r.who} | ${r.loss.toFixed(1)}% | ${r.best} | ${r.ok ? 'ok' : `FAIL: ${r.note}`} |`,
    ),
    '',
    `${rows.length} moves checked, ${failed.length} failed.`,
  ].join('\n');
  const report = flag('--report');
  if (report) writeFileSync(report, `${md}\n`);
  for (const r of failed) console.error(`  ✗ ${r.chapter}: ${r.path} — ${r.note} (best ${r.best})`);
  console.log(`${rows.length} moves checked, ${failed.length} failed.${report ? ` Report: ${report}` : ''}`);
  if (failed.length) process.exitCode = 1;
}

const engine = new Engine();
await engine.init();
try {
  const ex = flag('--explore');
  if (ex !== undefined) await explore(engine, ex);
  else await check(engine, args.find((a) => a.endsWith('.pgn')) ?? '');
} finally {
  engine.kill();
}
