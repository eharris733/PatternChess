import { isTrainable, winningChancesLost } from '../chess/winningChances';
import type { ParsedPosition } from '../services/pgnParserService';
import {
  parseBestMove,
  parseDepth,
  parseEvalCp,
  parseInfoLine,
  parsePrincipalVariation,
} from './uci';

const ENGINE_MT = '/stockfish/stockfish-18-lite.js';
const ENGINE_ST = '/stockfish/stockfish-18-lite-single.js';

export interface PositionEval {
  scoreCp: number;
  bestMove: string;
  principalVariation: string[];
  /** Deepest completed search depth, or null if the engine reported none. */
  depth: number | null;
}

export interface BlunderCandidate {
  fen: string;
  moveNumber: number;
  playedMove: string;
  sideToMove: string;
  evalBefore: number;
  evalAfter: number;
  evalSwing: number;
  correctMoves: Array<{ move: string; eval: number }>;
  /** Best-move PV from `fen` (solutionPv[0] === correctMoves[0].move). */
  solutionPv: string[];
  /** Refutation PV from the position after the played move. */
  playedRefutationPv: string[];
}

interface PendingRequest {
  /** terminator that completes the request — first line that satisfies wins. */
  terminator: (line: string) => boolean;
  buffer: string[];
  resolve: (output: string) => void;
  reject: (err: Error) => void;
  /** Observes every line as it streams in, before the terminator check. */
  onLine?: (line: string) => void;
  /** True for `go …` requests: `stop` is meaningful and a timeout asks the engine to wrap up first. */
  search: boolean;
}

export interface SmartEvalOptions {
  /** Hard time cap; the engine stops at this OR `maxDepth`, whichever comes first. */
  movetimeMs: number;
  /** Depth cap — no point thinking past this even with time left (simple endgames hit it fast). */
  maxDepth: number;
  /**
   * Early stop for decided positions: once an iteration of at least
   * `decidedMinDepth` reports |score| ≥ this many centipawns, the search is
   * stopped and the current best line is returned. Omit to always run to the
   * time/depth cap.
   */
  decidedCp?: number;
  decidedMinDepth?: number;
  pvMoves?: number;
}

/** After a timed-out search is told to `stop`, how long to wait for its `bestmove` before giving up on the worker. */
const STOP_GRACE_MS = 1_000;

export class StockfishWorkerClient {
  private worker: Worker | null = null;
  private ready = false;
  private mode: 'mt' | 'st' | null = null;
  private pending: PendingRequest | null = null;
  private commandQueue: Promise<unknown> = Promise.resolve();

  get isReady(): boolean {
    return this.ready;
  }

  get engineMode(): 'mt' | 'st' | null {
    return this.mode;
  }

  async init(opts: { preferST?: boolean } = {}): Promise<void> {
    if (this.ready) return;
    if (opts.preferST) {
      this.worker = await this.tryLoad(ENGINE_ST);
      this.mode = 'st';
      // eslint-disable-next-line no-console
      console.log('Stockfish Lite ST ready (analysis worker)');
    } else {
      try {
        this.worker = await this.tryLoad(ENGINE_MT);
        this.mode = 'mt';
        // eslint-disable-next-line no-console
        console.log('Stockfish Lite MT ready');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('Stockfish Lite MT failed, falling back to single-threaded:', err);
        this.worker = await this.tryLoad(ENGINE_ST);
        this.mode = 'st';
        // eslint-disable-next-line no-console
        console.log('Stockfish Lite ST ready (single-threaded fallback)');
      }
    }
    this.attachPersistentHandler();
    await this.send('isready', (line) => line.includes('readyok'));
    this.ready = true;
  }

  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.mode = null;
    this.pending = null;
  }

  private tryLoad(path: string): Promise<Worker> {
    return new Promise((resolve, reject) => {
      let resolved = false;
      const worker = new Worker(path);
      const timeout = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        worker.terminate();
        reject(new Error('Worker load timeout'));
      }, 30_000);

      const onMessage = (e: MessageEvent) => {
        const line = typeof e.data === 'string' ? e.data : String(e.data);
        if (line.includes('uciok')) {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          resolve(worker);
        }
      };
      const onError = (e: ErrorEvent) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(e.message || 'Worker load error'));
      };

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage('uci');
    });
  }

  private attachPersistentHandler() {
    if (!this.worker) return;
    this.worker.onmessage = (e: MessageEvent) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      const req = this.pending;
      if (!req) return;
      req.buffer.push(line);
      if (req.onLine) {
        try {
          req.onLine(line);
        } catch (err) {
          // A misbehaving observer must never strand the request.
          console.warn('[stockfish] onLine observer threw', err);
        }
      }
      if (req.terminator(line)) {
        const out = req.buffer.join('\n');
        this.pending = null;
        req.resolve(out);
      }
    };
    this.worker.onerror = (e: ErrorEvent) => {
      const req = this.pending;
      if (req) {
        this.pending = null;
        req.reject(new Error(e.message || 'Worker error'));
      }
    };
  }

  /**
   * Abort the ACTIVE search, if any. The engine answers `stop` with its
   * `bestmove`, which is the normal terminator, so the pending request resolves
   * early with whatever depth it reached. Queue-safe: `pending` is only set once
   * a request is at the head of the queue, so a `stop` can never target a
   * queued-but-unsent `go`. No-op for non-search requests.
   */
  stop(): void {
    if (this.worker && this.pending?.search) this.worker.postMessage('stop');
  }

  /**
   * Send one or more commands and wait for `terminator` to fire. Serializes with
   * prior commands. When `timeoutMs` is set and the terminator never fires, the
   * whole client is destroyed (a hung search's late output could satisfy the
   * *next* request's terminator) and the promise rejects — callers obtain a
   * fresh client through the singleton getters, which re-init on `!isReady`.
   * Search requests get one `stop` and a short grace period first, so a
   * throttled background tab doesn't lose the worker after every long think.
   */
  send(
    commands: string | string[],
    terminator: (line: string) => boolean,
    timeoutMs?: number,
    opts: { onLine?: (line: string) => void; search?: boolean } = {},
  ): Promise<string> {
    const cmds = Array.isArray(commands) ? commands : [commands];
    const next = this.commandQueue.then(
      () =>
        new Promise<string>((resolve, reject) => {
          if (!this.worker) {
            reject(new Error('Worker not initialized'));
            return;
          }
          let timer: ReturnType<typeof setTimeout> | null = null;
          const clear = () => {
            if (timer !== null) clearTimeout(timer);
            timer = null;
          };
          const req: PendingRequest = {
            terminator,
            buffer: [],
            resolve: (out) => {
              clear();
              resolve(out);
            },
            reject: (err) => {
              clear();
              reject(err);
            },
            onLine: opts.onLine,
            search: opts.search ?? false,
          };
          this.pending = req;
          if (timeoutMs && timeoutMs > 0) {
            const giveUp = () => {
              if (this.pending !== req) return;
              this.destroy();
              req.reject(new Error(`Engine command timed out after ${timeoutMs}ms`));
            };
            timer = setTimeout(() => {
              if (this.pending !== req) return;
              if (req.search && this.worker) {
                // Ask the engine to wrap up; its bestmove is the terminator.
                this.worker.postMessage('stop');
                timer = setTimeout(giveUp, STOP_GRACE_MS);
                return;
              }
              giveUp();
            }, timeoutMs);
          }
          for (const c of cmds) this.worker.postMessage(c);
        }),
    );
    this.commandQueue = next.catch(() => {});
    return next;
  }

  /**
   * Apply UCI options (e.g. Skill Level, UCI_LimitStrength/UCI_Elo). Only ever
   * call this on a dedicated opponent client — option state on the shared UI or
   * analysis singletons would corrupt their evaluations.
   */
  async setOptions(opts: Record<string, string | number | boolean>): Promise<void> {
    const cmds = Object.entries(opts).map(
      ([name, value]) => `setoption name ${name} value ${value}`,
    );
    await this.send([...cmds, 'isready'], (line) => line.includes('readyok'), 5_000);
  }

  /** Reset engine state (hash, killers) between unrelated games/drills. */
  async newGame(): Promise<void> {
    await this.send(['ucinewgame', 'isready'], (line) => line.includes('readyok'), 5_000);
  }

  /**
   * Movetime-bounded evaluation — fixed thinking time instead of fixed depth,
   * which keeps evals honest in positions (deep endgames especially) where a
   * fixed depth stops far short of the horizon. `bestMove` is '' at terminal
   * positions (`bestmove (none)`) — callers must treat that as game-over, and
   * should verify with chess.js first since `scoreCp` is a meaningless 0 there.
   */
  async evaluatePositionTimed(fen: string, movetimeMs: number, pvMoves = 5): Promise<PositionEval> {
    const out = await this.send(
      [`position fen ${fen}`, `go movetime ${movetimeMs}`],
      (line) => line.startsWith('bestmove'),
      movetimeMs + 3_000,
      { search: true },
    );
    return {
      scoreCp: parseEvalCp(out),
      bestMove: parseBestMove(out),
      principalVariation: parsePrincipalVariation(out, pvMoves),
      depth: parseDepth(out),
    };
  }

  /** Movetime-bounded best move for playing *against* the user. */
  async bestMoveTimed(fen: string, movetimeMs: number): Promise<PositionEval> {
    return this.evaluatePositionTimed(fen, movetimeMs, 5);
  }

  /**
   * "Smart depth": `go depth N movetime M` — UCI stops at whichever bound is
   * hit first, so simple endgames (which reach depth 28+ in a fraction of a
   * second) return early, while complex positions still get the full time.
   * With `decidedCp` set, an iteration of at least `decidedMinDepth` that
   * reports a decided score (|cp| ≥ decidedCp, mate always) stops the search
   * immediately. Same terminal-position caveats as `evaluatePositionTimed`.
   */
  async evaluateSmart(fen: string, opts: SmartEvalOptions): Promise<PositionEval> {
    const { movetimeMs, maxDepth, decidedCp, decidedMinDepth = 12, pvMoves = 5 } = opts;
    let stopped = false;
    const onLine =
      decidedCp == null
        ? undefined
        : (line: string) => {
            if (stopped) return;
            const info = parseInfoLine(line);
            if (!info || info.bound) return;
            if (info.depth >= decidedMinDepth && Math.abs(info.cp) >= decidedCp) {
              stopped = true;
              this.stop();
            }
          };
    const out = await this.send(
      [`position fen ${fen}`, `go depth ${maxDepth} movetime ${movetimeMs}`],
      (line) => line.startsWith('bestmove'),
      movetimeMs + 3_000,
      { onLine, search: true },
    );
    return {
      scoreCp: parseEvalCp(out),
      bestMove: parseBestMove(out),
      principalVariation: parsePrincipalVariation(out, pvMoves),
      depth: parseDepth(out),
    };
  }

  async evaluatePositionFull(
    fen: string,
    depth = 12,
    pvMoves = 5,
    timeoutMs = 45_000,
  ): Promise<PositionEval> {
    const out = await this.send(
      [`position fen ${fen}`, `go depth ${depth}`],
      (line) => line.startsWith('bestmove'),
      timeoutMs,
      { search: true },
    );
    return {
      scoreCp: parseEvalCp(out),
      bestMove: parseBestMove(out),
      principalVariation: parsePrincipalVariation(out, pvMoves),
      depth: parseDepth(out),
    };
  }

  /**
   * Mirror of StockfishService.analyzeGame: evaluate every position once,
   * then walk pairs and emit BlunderCandidate when chances-lost ≥ 15%.
   * Stores `evalSwing` as the rounded chances-lost percent (matches Dart).
   */
  async analyzeGame(
    positions: ParsedPosition[],
    opts: {
      depth?: number;
      playerSide?: 'white' | 'black' | null;
      onProgress?: (current: number, total: number) => void;
    } = {},
  ): Promise<BlunderCandidate[]> {
    const { depth = 12, playerSide = null, onProgress } = opts;

    const positionEvals: PositionEval[] = [];
    for (let i = 0; i < positions.length; i++) {
      onProgress?.(i, positions.length);
      // 10 PV plies (vs the display default of 5) so the stored solution line
      // has headroom for multi-move drills and motif detection.
      const ev = await this.evaluatePositionFull(positions[i].fen, depth, 10);
      positionEvals.push(ev);
    }

    const out: BlunderCandidate[] = [];
    for (let i = 0; i < positions.length - 1; i++) {
      const pos = positions[i];
      if (!pos.uciMove) continue;
      if (playerSide && pos.sideToMove !== playerSide) continue;
      if (pos.uciMove === positionEvals[i].bestMove) continue;

      const chancesLost = winningChancesLost(
        positionEvals[i].scoreCp,
        positionEvals[i + 1].scoreCp,
      );
      if (!isTrainable(chancesLost)) continue;

      out.push({
        fen: pos.fen,
        moveNumber: pos.moveNumber,
        playedMove: pos.uciMove,
        sideToMove: pos.sideToMove,
        evalBefore: positionEvals[i].scoreCp,
        evalAfter: positionEvals[i + 1].scoreCp,
        evalSwing: Math.round(chancesLost),
        correctMoves: [
          { move: positionEvals[i].bestMove, eval: positionEvals[i].scoreCp },
        ],
        solutionPv: positionEvals[i].principalVariation,
        playedRefutationPv: positionEvals[i + 1].principalVariation,
      });
    }
    return out;
  }
}
