#!/usr/bin/env node
// Engine- and transcript-check every move and note of a course PGN before it ships.
//
//   npm run course:check -- <lesson.pgn> [--depth 22] [--report out.md]
//        [--clip 0:00-13:31] [--transcript data/course-video/<id>/transcript.json]
//   npm run course:check -- --explore "e4 c5 Nf3" [--fen <fen>]   # MultiPV 5, for authoring
//
// Native Stockfish (`brew install stockfish`; override with STOCKFISH=path).
//
// Moves, all in Lichess winning chances (src/chess/winningChances.ts):
//   - a move the learner plays (chapter orientation) fails above 5% lost vs
//     the engine's best — the training accept rule — unless the author marked
//     it ?/??/?! (then it's a trap the drill rejects, and it must really be
//     worse: ≥ 5% lost for ?/??, ≥ 2% for ?!);
//   - an opponent move fails above 15% lost unless marked; a marked opponent
//     move must really be worse, like a learner trap;
//   - an unmarked learner sideline with no continuation is a "good move, now
//     find the main one" nudge in the drill, so it only has to be sound
//     (under 10% lost).
//   Positions with ≤ 7 pieces search to depth 30 (endgames need it).
//   At learner nodes, engine moves within 5% that the PGN doesn't list are
//   printed so the author can add them as accepted alternatives (from the top
//   5 lines, or every legal move with ≤ 7 pieces).
//
// Notes (the chapter intro and every move comment):
//   - every note carries a [%ts] inside the day's clip (--clip, or found
//     from the course catalogs by the lesson's slug); only a note on a
//     learner alternative (an engine addition, "Also good…") may go without;
//   - a note on an opponent move says more than the move itself
//     (isFillerNote): each one is a pause the learner clicks through;
//   - the transcript around that moment backs the note up (matchNote in
//     src/learn/transcriptMatch.ts): a square it names is spoken within 45 s,
//     or its content words are. The transcript is found from the learn
//     catalog's `source` (fetch it with npm run course:video -- <id>).
//
// Trainability: each chapter has ≥ 1 learner decision and the lesson ≥ 3 (a floor,
// never a target: never pad a line past what the creator shows to reach it),
// counted over every run (main line + opponent sidelines, src/learn/lessonRuns.ts).
//
// Exits 1 on any failure.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parse } from '@mliebelt/pgn-parser';
import { Chess } from 'chess.js';
import { chapterFromGame, isStandardChapter, type ParsedGame } from '../src/learn/pgnToTree.ts';
import { chapterDecisions } from '../src/learn/lessonRuns.ts';
import { formatClock, isFillerNote, matchNote, parseClock, spokenBetween, type TranscriptSegment } from '../src/learn/transcriptMatch.ts';
import { classify, winningChancesLost } from '../src/chess/winningChances.ts';
import { BAD_MOVE_NAGS, type LearnChapter, type LearnNode } from '../src/models/learn.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DEPTH = Number(flag('--depth') ?? 22);
const ENDGAME_DEPTH = Math.max(DEPTH, 30);
const ENGINE = process.env.STOCKFISH ?? '/opt/homebrew/bin/stockfish';
const LEARNER_MAX_LOSS = 5;
const OPPONENT_MAX_LOSS = 15;
const DUBIOUS_MIN_LOSS = 2;
const MOVETIME_MS = Number(flag('--movetime') ?? 8000);
const MIN_CHAPTER_DECISIONS = 1;
const MIN_LESSON_DECISIONS = Number(flag('--min-decisions') ?? 3);
const root = resolve(dirname(new URL(import.meta.url).pathname), '..');

interface Line {
  cp: number; // side-to-move POV, mate mapped to ±(10000 - n)
  uci: string;
}

const pieceCount = (fen: string) => fen.split(' ')[0].replace(/[^a-zA-Z]/g, '').length;

class Engine {
  private proc: ChildProcess;
  private buf = '';
  private waiter: { until: RegExp; resolve: (s: string) => void } | null = null;
  private cache = new Map<string, { multipv: number; lines: Line[] }>();
  private multipv = 0;

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
    this.proc.stdin!.write('setoption name Threads value 6\nsetoption name Hash value 512\n');
    await this.send('isready', /readyok/);
  }

  /** Top `multipv` lines at `fen`, best first. Terminal positions return []. */
  async lines(fen: string, multipv = 1): Promise<Line[]> {
    const hit = this.cache.get(fen);
    if (hit && hit.multipv >= multipv) return hit.lines;
    if (this.multipv !== multipv) {
      this.proc.stdin!.write(`setoption name MultiPV value ${multipv}\n`);
      this.multipv = multipv;
    }
    const endgame = pieceCount(fen) <= 7;
    const depth = endgame ? ENDGAME_DEPTH : DEPTH;
    // Depth first, with a time cap so one explosive position can't stall the run.
    const t0 = Date.now();
    const movetime = endgame ? MOVETIME_MS * 2 : MOVETIME_MS;
    // Watchdog: Stockfish has been seen searching far past movetime (a run
    // hung for over an hour), so stop the search outright if it overruns.
    const watchdog = setTimeout(() => this.proc.stdin!.write('stop\n'), movetime + 3000);
    const out = await this.send(`position fen ${fen}\ngo depth ${depth} movetime ${movetime}`, /(^|\n)bestmove /);
    clearTimeout(watchdog);
    if (Date.now() - t0 > movetime + 2500) console.error(`  (search overran its ${movetime / 1000}s cap and was stopped: ${fen})`);
    if (process.env.CHECK_VERBOSE) console.error(`    ${((Date.now() - t0) / 1000).toFixed(1)}s ${fen}`);
    // Deepest scored line per MultiPV slot (a forced mate can end the search early).
    const best = new Map<number, Line & { depth: number }>();
    for (const l of out.split('\n')) {
      if (/ (lower|upper)bound /.test(l)) continue;
      const m = / depth (\d+) .*multipv (\d+) score (cp|mate) (-?\d+).* pv (\S+)/.exec(l);
      if (!m) continue;
      const d = Number(m[1]);
      const slot = Number(m[2]);
      const v = Number(m[4]);
      const cp = m[3] === 'cp' ? v : v > 0 ? 10000 - v : -10000 - v;
      if ((best.get(slot)?.depth ?? -1) <= d) best.set(slot, { cp, uci: m[5], depth: d });
    }
    const top = Math.max(0, ...[...best.values()].map((l) => l.depth));
    const res = [...best.entries()]
      .filter(([, l]) => l.depth >= top - 1)
      .sort((a, b) => a[0] - b[0])
      .map(([, l]) => ({ cp: l.cp, uci: l.uci }));
    this.cache.set(fen, { multipv, lines: res });
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

async function explore(engine: Engine, moves: string, fen0?: string) {
  const c = new Chess(fen0);
  for (const m of moves.split(/\s+/).filter(Boolean)) {
    try {
      c.move(m.replace(/^\d+\.+/, ''));
    } catch {
      console.error(`illegal move "${m}" at ${c.fen()}`);
      process.exitCode = 1;
      return;
    }
  }
  const fen = c.fen();
  const lines = await engine.lines(fen, 5);
  console.log(fen);
  for (const l of lines) console.log(`  ${san(fen, l.uci).padEnd(7)} ${fmt(l.cp)}`);
}

// --- Where the lesson lives: learn-catalog entry, its video, the day's clip ---

interface LearnEntry {
  slug: string;
  pgnFile?: string;
  source?: { url: string };
}

function readJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null;
}

function lessonEntry(pgnPath: string): LearnEntry | null {
  const cat = readJson<{ studies: LearnEntry[] }>(join(root, 'content/learn/catalog.json'));
  const rel = relative(root, resolve(pgnPath));
  return cat?.studies.find((e) => e.pgnFile === rel) ?? null;
}

const youtubeId = (url: string) => /(?:v=|youtu\.be\/|embed\/)([\w-]{11})/.exec(url)?.[1] ?? null;

/** The clip of the course day whose `lesson` is `slug` (public catalog or supporter days). */
function lessonClip(slug: string): { start: number; end: number | null } | null {
  type Seg = { lesson?: string; start?: number | null; end?: number | null };
  const pub = readJson<{ courses: { days: Seg[] }[] }>(join(root, 'content/courses/catalog.json'));
  for (const c of pub?.courses ?? []) for (const d of c.days) if (d.lesson === slug) return { start: d.start ?? 0, end: d.end ?? null };
  const dir = join(root, 'content/supporter/courses');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const s = readJson<{ days: Record<string, Seg> }>(join(dir, f));
      for (const d of Object.values(s?.days ?? {})) if (d.lesson === slug) return { start: d.start ?? 0, end: d.end ?? null };
    }
  }
  return null;
}

// --- The check ---

interface Row {
  chapter: string;
  path: string;
  who: 'learner' | 'opponent';
  marked: boolean;
  loss: number;
  best: string;
  ok: boolean;
  note: string;
}

interface NoteRow {
  chapter: string;
  where: string;
  ts: number | null;
  text: string;
  excerpt: string;
  ok: boolean;
  problem: string;
}

async function check(engine: Engine, pgnPath: string) {
  const entry = lessonEntry(pgnPath);
  const clipArg = flag('--clip');
  const clip = clipArg
    ? (() => {
        const [a, b] = clipArg.split('-');
        return { start: parseClock(a), end: b ? parseClock(b) : null };
      })()
    : entry
      ? lessonClip(entry.slug)
      : null;
  const vid = entry?.source ? youtubeId(entry.source.url) : null;
  const transcriptPath = flag('--transcript') ?? (vid ? join(root, 'data/course-video', vid, 'transcript.json') : null);
  const transcript = transcriptPath ? readJson<TranscriptSegment[]>(transcriptPath) : null;
  const problems: string[] = [];
  if (!clip) problems.push('no clip: pass --clip m:ss-m:ss or set this lesson on a course day');
  if (!transcript) problems.push(`no transcript${transcriptPath ? ` at ${transcriptPath}` : ''}: run npm run course:video -- <youtubeId>`);

  const games = parse(readFileSync(pgnPath, 'utf8'), { startRule: 'games' }) as unknown as ParsedGame[];
  const rows: Row[] = [];
  const notes: NoteRow[] = [];
  const unspoken: string[] = [];
  const decisions: Array<{ chapter: string; n: number }> = [];

  // `engineNote`: a note on an accepted alternative the author added from the
  // engine ("Also good…"); it may go without a video moment.
  const checkNote = (chapter: string, where: string, text: string | undefined, ts: number | undefined, engineNote = false) => {
    if (!text) return;
    let problem = '';
    let excerpt = '';
    if (ts == null && engineNote) excerpt = '(engine note, no video moment)';
    else if (ts == null) problem = 'no [%ts]';
    else {
      if (clip && (ts < clip.start || (clip.end != null && ts > clip.end))) {
        problem = `[%ts ${formatClock(ts)}] is outside the clip ${formatClock(clip.start)}-${clip.end != null ? formatClock(clip.end) : 'end'}`;
      }
      if (transcript) {
        const m = matchNote(text, ts, transcript);
        excerpt = m.excerpt;
        if (!m.ok && !problem) problem = `transcript near ${formatClock(ts)} doesn't mention ${m.wanted.slice(0, 6).join(', ')}`;
      }
    }
    notes.push({ chapter, where, ts: ts ?? null, text, excerpt, ok: !problem, problem });
  };

  for (const [i, g] of games.entries()) {
    let ch: LearnChapter;
    try {
      if (!isStandardChapter(g)) throw new Error('not a standard-chess chapter');
      ch = chapterFromGame(g, i);
    } catch (e) {
      problems.push(`chapter ${i + 1}: ${(e as Error).message}`);
      continue;
    }
    checkNote(ch.name, 'intro', ch.intro, ch.introTs);
    decisions.push({ chapter: ch.name, n: chapterDecisions(ch) });

    // `lastTs`: the nearest video moment above this move (its parent's note,
    // or the intro); `engineLine`: inside an engine-only alternative.
    const walk = async (fen: string, nodes: LearnNode[], line: string[], lastTs: number | null, engineLine: boolean) => {
      if (nodes.length === 0) return;
      const mover = fen.split(' ')[1] === 'w' ? 'white' : 'black';
      const who = mover === ch.orientation ? 'learner' : 'opponent';
      // Where the learner moves, enough lines to suggest every unlisted good
      // move: five, or every legal move in an endgame (≤ 7 pieces), where
      // several king moves often win and the drill must accept each of them.
      const legal = new Chess(fen).moves().length;
      const top = await engine.lines(fen, who === 'learner' ? (pieceCount(fen) <= 7 ? Math.max(1, legal) : 5) : 1);
      const bestCp = top[0]?.cp ?? 0;
      const bestSan = top[0] ? san(fen, top[0].uci) : '-';
      for (const n of nodes) {
        const after = await engine.score(n.fen);
        const loss = Math.max(0, winningChancesLost(bestCp, after));
        const nags = n.nags ?? [];
        const marked = nags.some((x) => BAD_MOVE_NAGS.has(x));
        const minMarkedLoss = nags.includes(2) || nags.includes(4) ? LEARNER_MAX_LOSS : DUBIOUS_MIN_LOSS;
        let ok: boolean;
        let note = '';
        if (marked) {
          ok = loss >= minMarkedLoss;
          if (!ok) note = `marked bad but only loses ${loss.toFixed(1)}%`;
        } else if (who === 'learner' && n !== nodes[0] && n.children.length === 0) {
          ok = classify(loss) === 'good';
          if (!ok) note = `nudged as a good move but loses ${loss.toFixed(1)}%`;
        } else {
          ok = loss <= (who === 'learner' ? LEARNER_MAX_LOSS : OPPONENT_MAX_LOSS);
          if (!ok) note = `loses ${loss.toFixed(1)}%`;
        }
        const path = [...line, n.san].join(' ');
        rows.push({ chapter: ch.name, path, who, marked, loss, best: `${bestSan} ${fmt(bestCp)}`, ok, note });
        // Only an accepted alternative (an unmarked learner sideline the drill
        // nudges as good) may carry an engine note without a video moment; a
        // note on a ?/?? trap is the author's and needs its [%ts].
        const acceptedAlt = who === 'learner' && n !== nodes[0] && !marked && n.children.length === 0;
        checkNote(ch.name, path, n.comment, n.ts, acceptedAlt);
        // A note on an opponent move pauses the drill: it has to say something.
        if (who === 'opponent' && n.comment && isFillerNote(n.comment)) {
          const last = notes.at(-1)!;
          last.ok = false;
          last.problem = `filler note on an opponent move ("${n.comment}"): every opponent note is a pause, so drop it or say why the move matters`;
        }
        // Is the move itself in the video? Its square (or "castle") should be
        // spoken from just before the nearest note to two minutes after it.
        // An engine-only line (no video moment) need not be spoken; a trap
        // the author wrote a note on is from the video, so it must be.
        const engineAlt =
          engineLine || (who === 'learner' && n !== nodes[0] && n.ts == null && !(marked && n.comment));
        const at = n.ts ?? lastTs;
        if (transcript && !engineAlt && at != null) {
          const token = n.san.startsWith('O-O') ? 'castle' : n.uci.slice(2, 4);
          if (!spokenBetween(transcript, at - 20, at + 120, token)) unspoken.push(`${ch.name}: ${path} (${token} not spoken near ${formatClock(at)})`);
        }
        await walk(n.fen, n.children, [...line, n.san], n.ts ?? lastTs, engineAlt);
      }
      if (who === 'learner') {
        const listed = new Set(nodes.map((n) => n.uci));
        for (const l of top) {
          if (listed.has(l.uci)) continue;
          if (winningChancesLost(bestCp, -l.cp) <= LEARNER_MAX_LOSS) {
            console.log(`  ~ ${ch.name}: after "${line.join(' ') || 'start'}", ${san(fen, l.uci)} (${fmt(l.cp)}) is also within 5% — accept it?`);
          }
        }
      }
    };
    await walk(ch.startFen, ch.moves, [], ch.introTs ?? null, false);
  }

  for (const d of decisions) {
    if (d.n < MIN_CHAPTER_DECISIONS) problems.push(`chapter "${d.chapter}" has ${d.n} learner decision(s); needs ${MIN_CHAPTER_DECISIONS}`);
  }
  const total = decisions.reduce((s, d) => s + d.n, 0);
  if (total < MIN_LESSON_DECISIONS) problems.push(`lesson has ${total} learner decisions; needs ${MIN_LESSON_DECISIONS}`);

  const failed = rows.filter((r) => !r.ok);
  const badNotes = notes.filter((n) => !n.ok);
  const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const md = [
    `# Lesson report: ${relative(root, resolve(pgnPath))}`,
    '',
    `Stockfish depth ${DEPTH} (${ENDGAME_DEPTH} with ≤ 7 pieces). Learner moves within ${LEARNER_MAX_LOSS}% winning chances of best; opponent moves within ${OPPONENT_MAX_LOSS}% unless marked ?/??/?!.`,
    clip ? `Clip ${formatClock(clip.start)}-${clip.end != null ? formatClock(clip.end) : 'end'}${vid ? ` of https://www.youtube.com/watch?v=${vid}` : ''}.` : 'No clip.',
    '',
    `Learner decisions: ${decisions.map((d) => `${d.chapter} ${d.n}`).join(', ')} (total ${total}).`,
    '',
    ...(problems.length ? ['## Problems', '', ...problems.map((p) => `- ${p}`), ''] : []),
    '## Moves',
    '',
    '| Chapter | Line | Side | Lost | Engine best | Result |',
    '|---|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${esc(r.chapter)} | ${r.path}${r.marked ? ' (marked bad)' : ''} | ${r.who} | ${r.loss.toFixed(1)}% | ${r.best} | ${r.ok ? 'ok' : `FAIL: ${r.note}`} |`,
    ),
    '',
    '## Moves not heard in the video',
    '',
    'Each move\'s square should be spoken near its note. These were not: check the frames, or cut a line the creator never plays.',
    '',
    ...(unspoken.length ? unspoken.map((u) => `- ${u}`) : ['(none)']),
    '',
    '## Notes vs transcript',
    '',
    '| Chapter | At | Time | Note | Transcript | Result |',
    '|---|---|---|---|---|---|',
    ...notes.map(
      (n) =>
        `| ${esc(n.chapter)} | ${esc(n.where)} | ${n.ts != null ? formatClock(n.ts) : '-'} | ${esc(n.text)} | ${esc(n.excerpt)} | ${n.ok ? 'ok' : `FAIL: ${n.problem}`} |`,
    ),
    '',
    `${rows.length} moves checked, ${failed.length} failed; ${notes.length} notes, ${badNotes.length} failed; ${problems.length} other problem(s).`,
  ].join('\n');
  const report = flag('--report') ?? join(root, 'data/course-video/reports', `${basename(pgnPath, '.pgn')}.md`);
  mkdirSync(dirname(report), { recursive: true });
  writeFileSync(report, `${md}\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  for (const r of failed) console.error(`  ✗ ${r.chapter}: ${r.path} — ${r.note} (best ${r.best})`);
  for (const n of badNotes) console.error(`  ✗ ${n.chapter} @ ${n.where}: ${n.problem}`);
  for (const u of unspoken) console.error(`  ? not heard: ${u}`);
  console.log(
    `${rows.length} moves checked, ${failed.length} failed; ${notes.length} notes, ${badNotes.length} failed; ${total} learner decisions; ${unspoken.length} move(s) not heard in the video (review); ${problems.length} other problem(s). Report: ${relative(root, report)}`,
  );
  if (failed.length || badNotes.length || problems.length) process.exitCode = 1;
}

const engine = new Engine();
await engine.init();
try {
  const ex = flag('--explore');
  if (ex !== undefined) await explore(engine, ex, flag('--fen'));
  else {
    const pgn = args.find((a) => a.endsWith('.pgn'));
    if (!pgn) throw new Error('usage: npm run course:check -- <lesson.pgn> [--clip m:ss-m:ss]');
    await check(engine, pgn);
  }
} finally {
  engine.kill();
}
