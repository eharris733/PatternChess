import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StockfishWorkerClient } from './stockfishWorkerClient';

type Listener = (e: { data: string }) => void;

/**
 * Scripted worker: answers `uci`/`isready` immediately, streams `goLines` for
 * a `go`, then emits `bestmove` (unless `hangAfterGo`), and stops streaming
 * when it receives `stop` (answering with `bestmove` unless `ignoreStop`).
 */
class FakeWorker {
  static instances: FakeWorker[] = [];
  static goLines: string[] = [];
  static hangAfterGo = false;
  static ignoreStop = false;

  posted: string[] = [];
  terminated = false;
  onmessage: Listener | null = null;
  onerror: ((e: unknown) => void) | null = null;
  private listeners = new Set<Listener>();
  private goActive = false;

  constructor(public path: string) {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, fn: Listener) {
    if (type === 'message') this.listeners.add(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    if (type === 'message') this.listeners.delete(fn);
  }
  terminate() {
    this.terminated = true;
  }

  private emit(line: string) {
    const e = { data: line };
    for (const l of [...this.listeners]) l(e);
    this.onmessage?.(e);
  }

  postMessage(cmd: string) {
    this.posted.push(cmd);
    if (cmd === 'uci') queueMicrotask(() => this.emit('uciok'));
    else if (cmd === 'isready') queueMicrotask(() => this.emit('readyok'));
    else if (cmd.startsWith('go')) void this.runGo();
    else if (cmd === 'stop' && this.goActive && !FakeWorker.ignoreStop) {
      // A real engine answers `stop` with its current bestmove.
      this.goActive = false;
      queueMicrotask(() => this.emit('bestmove e2e4 ponder e7e5'));
    }
  }

  private async runGo() {
    this.goActive = true;
    for (const line of FakeWorker.goLines) {
      await Promise.resolve();
      if (!this.goActive) return;
      this.emit(line);
    }
    await Promise.resolve();
    if (this.goActive && !FakeWorker.hangAfterGo) {
      this.goActive = false;
      this.emit('bestmove e2e4 ponder e7e5');
    }
  }
}

async function readyClient(): Promise<{ client: StockfishWorkerClient; worker: FakeWorker }> {
  const client = new StockfishWorkerClient();
  await client.init({ preferST: true });
  const worker = FakeWorker.instances[FakeWorker.instances.length - 1]!;
  worker.posted.length = 0;
  return { client, worker };
}

beforeEach(() => {
  FakeWorker.instances.length = 0;
  FakeWorker.goLines = [];
  FakeWorker.hangAfterGo = false;
  FakeWorker.ignoreStop = false;
  vi.stubGlobal('Worker', FakeWorker);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('evaluateSmart', () => {
  it('sends a combined depth + movetime go and parses the result', async () => {
    const { client, worker } = await readyClient();
    FakeWorker.goLines = [
      'info depth 10 seldepth 14 score cp 31 nodes 1 nps 1 pv e2e4 e7e5',
      'info depth 12 seldepth 18 score cp 34 nodes 1 nps 1 pv e2e4 e7e5 g1f3',
    ];
    const ev = await client.evaluateSmart('fen-here', { movetimeMs: 2500, maxDepth: 28 });
    expect(worker.posted).toEqual(['position fen fen-here', 'go depth 28 movetime 2500']);
    expect(ev).toEqual({ scoreCp: 34, bestMove: 'e2e4', principalVariation: ['e2e4', 'e7e5', 'g1f3'], depth: 12 });
  });

  it('stops once a decided score is reported at the minimum depth', async () => {
    const { client, worker } = await readyClient();
    FakeWorker.goLines = [
      'info depth 12 score cp 900 pv a1a2',
      'info depth 18 score cp 1100 pv a1a2',
      'info depth 19 score cp 1150 pv a1a3',
      'info depth 20 score cp 1200 pv a1a4',
    ];
    const ev = await client.evaluateSmart('fen', { movetimeMs: 2500, maxDepth: 28, decidedCp: 1000, decidedMinDepth: 18 });
    expect(worker.posted.filter((c) => c === 'stop')).toHaveLength(1);
    // The search was cut after the depth-18 line, so deeper lines never arrived.
    expect(ev.depth).toBe(18);
    expect(ev.scoreCp).toBe(1100);
  });

  it('ignores lowerbound/upperbound iterations for the early stop', async () => {
    const { client, worker } = await readyClient();
    FakeWorker.goLines = [
      'info depth 18 score cp 1500 lowerbound pv a1a2',
      'info depth 18 score cp 400 pv a1a2',
    ];
    const ev = await client.evaluateSmart('fen', { movetimeMs: 2500, maxDepth: 28, decidedCp: 1000, decidedMinDepth: 18 });
    expect(worker.posted).not.toContain('stop');
    expect(ev.scoreCp).toBe(400);
  });

  it('always stops on a mate score', async () => {
    const { client, worker } = await readyClient();
    FakeWorker.goLines = ['info depth 18 score mate 4 pv a1a2', 'info depth 19 score mate 3 pv a1a2'];
    const ev = await client.evaluateSmart('fen', { movetimeMs: 2500, maxDepth: 28, decidedCp: 1000, decidedMinDepth: 18 });
    expect(worker.posted.filter((c) => c === 'stop')).toHaveLength(1);
    expect(ev.scoreCp).toBe(9996);
  });
});

describe('stop', () => {
  it('posts nothing when no search is active', async () => {
    const { client, worker } = await readyClient();
    client.stop();
    expect(worker.posted).toEqual([]);
  });

  it('posts nothing during a non-search request', async () => {
    const { client, worker } = await readyClient();
    const p = client.newGame();
    client.stop();
    await p;
    expect(worker.posted).not.toContain('stop');
  });
});

describe('search timeout', () => {
  it('asks the engine to stop first and destroys the worker only after the grace period', async () => {
    vi.useFakeTimers();
    const { client, worker } = await readyClient();
    FakeWorker.hangAfterGo = true;
    FakeWorker.ignoreStop = true;
    const p = client.evaluateSmart('fen', { movetimeMs: 1000, maxDepth: 28 });
    const rejection = expect(p).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(4000);
    expect(worker.posted).toContain('stop');
    expect(worker.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(worker.terminated).toBe(true);
    expect(client.isReady).toBe(false);
    await rejection;
  });

  it('resolves normally when the stopped engine answers with bestmove', async () => {
    vi.useFakeTimers();
    const { client, worker } = await readyClient();
    FakeWorker.hangAfterGo = true;
    const p = client.evaluateSmart('fen', { movetimeMs: 1000, maxDepth: 28 });
    await vi.advanceTimersByTimeAsync(4000);
    const ev = await p;
    expect(worker.posted).toContain('stop');
    expect(worker.terminated).toBe(false);
    expect(ev.bestMove).toBe('e2e4');
  });
});
