/**
 * One-shot blunder enrichment: fills solution_line + motifs on legacy rows for
 * the given user ids, using the same depth-12 engine settings and motif
 * detector as in-app analysis (src/chess/motifs.ts). Runs Stockfish lite
 * (single-threaded build) as Node child processes, POOL_SIZE at a time.
 *
 * Usage:
 *   npx esbuild scripts/enrich-blunders.ts --bundle --platform=node \
 *     --format=esm --outfile=<tmp>/enrich-blunders.mjs
 *   node <tmp>/enrich-blunders.mjs --users id1,id2 [--dry-run] [--limit N]
 *
 * Reads VITE_SUPABASE_URL and the service key from .env.local (service key
 * required — enrichment writes bypass RLS).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { detectMotifs } from '../src/chess/motifs';
import { CASTLING_NORMALIZE, parseUciMove } from '../src/chess/moveUtils';
import { parseEvalCp, parsePrincipalVariation } from '../src/stockfish/uci';

const ENGINE_PATH = 'node_modules/stockfish/bin/stockfish-18-lite-single.js';
const POOL_SIZE = 4;
const DEPTH = 12;
const PV_MOVES = 10;

interface Row {
  id: string;
  fen: string;
  played_move: string;
  eval_before: number;
  eval_after: number;
}

function env(): { url: string; key: string } {
  const raw = readFileSync('.env.local', 'utf8');
  const get = (name: string) => raw.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim();
  const url = get('VITE_SUPABASE_URL');
  const key = get('SUPABASE_SERVICE_ROLE_KEY') ?? get('SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Missing VITE_SUPABASE_URL or service key in .env.local');
  return { url, key };
}

class Engine {
  private proc: ChildProcess;
  private buffer = '';
  private waiter: { test: (buf: string) => boolean; resolve: (buf: string) => void } | null = null;

  constructor() {
    this.proc = spawn(process.execPath, [ENGINE_PATH], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.proc.stdout!.on('data', (d) => {
      this.buffer += d.toString();
      if (this.waiter && this.waiter.test(this.buffer)) {
        const w = this.waiter;
        const out = this.buffer;
        this.waiter = null;
        this.buffer = '';
        w.resolve(out);
      }
    });
  }

  private send(cmd: string, until: (buf: string) => boolean): Promise<string> {
    return new Promise((resolve) => {
      this.waiter = { test: until, resolve };
      this.proc.stdin!.write(cmd + '\n');
    });
  }

  async init(): Promise<void> {
    await this.send('uci', (b) => b.includes('uciok'));
    await this.send('isready', (b) => b.includes('readyok'));
  }

  async evaluate(fen: string): Promise<{ scoreCp: number; pv: string[] }> {
    const out = await this.send(
      `position fen ${fen}\ngo depth ${DEPTH}`,
      (b) => /(^|\n)bestmove /.test(b),
    );
    return { scoreCp: parseEvalCp(out), pv: parsePrincipalVariation(out, PV_MOVES) };
  }

  kill(): void {
    this.proc.kill();
  }
}

function applyMove(fen: string, uci: string): string | null {
  try {
    const chess = new Chess(fen);
    const std = CASTLING_NORMALIZE[uci] ?? uci;
    const m = parseUciMove(std);
    if (!chess.move({ from: m.from, to: m.to, promotion: m.promotion })) return null;
    return chess.fen();
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const usersArg = args[args.indexOf('--users') + 1];
  if (!args.includes('--users') || !usersArg) throw new Error('--users id1,id2 is required');
  const users = usersArg.split(',');
  const dryRun = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;

  const { url, key } = env();
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  // Page through every unenriched row for the target users.
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(
      `${url}/rest/v1/blunders?select=id,fen,played_move,eval_before,eval_after` +
        `&user_id=in.(${users.join(',')})&solution_line=is.null` +
        `&order=created_at.desc&offset=${offset}&limit=1000`,
      { headers },
    );
    if (!res.ok) throw new Error(`fetch rows: ${res.status} ${await res.text()}`);
    const page = (await res.json()) as Row[];
    rows.push(...page);
    if (page.length < 1000 || rows.length >= limit) break;
  }
  const work = rows.slice(0, limit === Infinity ? rows.length : limit);
  console.log(`${work.length} unenriched rows for ${users.length} user(s)`);
  if (work.length === 0) return;
  if (dryRun) return;

  const engines = Array.from({ length: Math.min(POOL_SIZE, work.length) }, () => new Engine());
  await Promise.all(engines.map((e) => e.init()));

  let next = 0;
  let done = 0;
  let failed = 0;
  const started = Date.now();

  async function patch(id: string, body: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${url}/rest/v1/blunders?id=eq.${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`patch ${id}: ${res.status} ${await res.text()}`);
  }

  await Promise.all(
    engines.map(async (engine) => {
      while (next < work.length) {
        const row = work[next++];
        try {
          const best = await engine.evaluate(row.fen);
          const afterFen = applyMove(row.fen, row.played_move);
          const played = afterFen ? await engine.evaluate(afterFen) : { scoreCp: 0, pv: [] };
          const motifs = detectMotifs({
            fen: row.fen,
            playedMove: row.played_move,
            solutionPv: best.pv,
            playedRefutationPv: played.pv,
            evalBefore: row.eval_before,
            evalAfter: row.eval_after,
          });
          await patch(row.id, {
            solution_line: { pv: best.pv, playedPv: played.pv, v: 1 },
            motifs,
          });
        } catch (err) {
          failed++;
          console.warn(`row ${row.id} failed:`, err);
          // Tombstone (parses back to null in the app) so reruns skip it.
          try {
            await patch(row.id, { solution_line: { pv: [], playedPv: [], v: 1 }, motifs: [] });
          } catch {
            /* leave for a rerun */
          }
        }
        done++;
        if (done % 25 === 0 || done === work.length) {
          const rate = done / ((Date.now() - started) / 60000);
          console.log(
            `${done}/${work.length} (${failed} failed, ${rate.toFixed(0)}/min, ~${Math.round(
              (work.length - done) / Math.max(rate, 1),
            )} min left)`,
          );
        }
      }
      engine.kill();
    }),
  );

  console.log(`Done: ${done} processed, ${failed} failed, ${Math.round((Date.now() - started) / 1000)}s`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
