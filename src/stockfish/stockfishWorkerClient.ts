import { isTrainable, winningChancesLost } from '../chess/winningChances';
import type { ParsedPosition } from '../services/pgnParserService';
import { parseBestMove, parseEvalCp, parsePrincipalVariation } from './uci';

const ENGINE_MT = '/stockfish/stockfish-18-lite.js';
const ENGINE_ST = '/stockfish/stockfish-18-lite-single.js';

export interface PositionEval {
  scoreCp: number;
  bestMove: string;
  principalVariation: string[];
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
}

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

  /** Send one or more commands and wait for `terminator` to fire. Serializes with prior commands. */
  send(commands: string | string[], terminator: (line: string) => boolean): Promise<string> {
    const cmds = Array.isArray(commands) ? commands : [commands];
    const next = this.commandQueue.then(
      () =>
        new Promise<string>((resolve, reject) => {
          if (!this.worker) {
            reject(new Error('Worker not initialized'));
            return;
          }
          this.pending = { terminator, buffer: [], resolve, reject };
          for (const c of cmds) this.worker.postMessage(c);
        }),
    );
    this.commandQueue = next.catch(() => {});
    return next;
  }

  async evaluatePositionFull(fen: string, depth = 12, pvMoves = 5): Promise<PositionEval> {
    const out = await this.send([`position fen ${fen}`, `go depth ${depth}`], (line) =>
      line.startsWith('bestmove'),
    );
    return {
      scoreCp: parseEvalCp(out),
      bestMove: parseBestMove(out),
      principalVariation: parsePrincipalVariation(out, pvMoves),
    };
  }

  async evaluateMove(fen: string, uciMove: string, timeMs = 500): Promise<PositionEval> {
    const out = await this.send(
      [`position fen ${fen} moves ${uciMove}`, `go movetime ${timeMs}`],
      (line) => line.startsWith('bestmove'),
    );
    return {
      scoreCp: parseEvalCp(out),
      bestMove: parseBestMove(out),
      principalVariation: parsePrincipalVariation(out),
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
