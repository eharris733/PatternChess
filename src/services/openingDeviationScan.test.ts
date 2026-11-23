import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpeningDeviation } from '../chess/openingDeviation';
import type { OpeningGroupKey } from './db/openingDeviations';

/**
 * Scheduling of the openings scan (`startOpeningDeviationScan`): the priority
 * opening while sync analysis runs, the long tail after, and who keeps a
 * pass alive. The database, engine and sync state are in-memory fakes.
 */

const db = vi.hoisted(() => ({
  pending: [] as OpeningDeviation[],
  unanalyzed: 0,
  scored: [] as string[],
  groupsAsked: [] as (OpeningGroupKey | null)[],
  /** Every write answers 401 (the session ended). */
  signedOut: false,
  writeAttempts: 0,
}));
const sync = vi.hoisted(() => ({ inFlight: false }));

vi.mock('./supabaseService', () => ({
  supabaseService: {
    countUncheckedDeviationGames: async () => 0,
    getUncheckedDeviationGames: async () => [],
    countPendingDeviationEvals: async () => db.pending.length,
    getPendingDeviationEvals: async ({ limit, group }: { limit: number; group?: OpeningGroupKey | null }) => {
      db.groupsAsked.push(group ?? null);
      return db.pending
        .filter((d) => !group || (d.openingFamily === group.family && d.userColor === group.color))
        .slice(0, limit);
    },
    countPastBookQueue: async () => 0,
    getPastBookQueue: async () => [],
    countUnanalyzedGames: async () => db.unanalyzed,
    setDeviationEval: async (id: string) => {
      db.writeAttempts++;
      if (db.signedOut) throw new ApiError(401, 'unauthorized', 'Sign in required');
      db.scored.push(id);
      db.pending = db.pending.filter((d) => d.id !== id);
    },
    retireOrphanOpeningDrills: async () => 0,
    findDrillForPosition: async () => null,
    insertOpeningDrill: async () => null,
  },
}));
vi.mock('../hooks/useStockfish', () => ({
  getAnalysisStockfish: async () => ({
    evaluateSmart: async () => ({ scoreCp: -20, depth: 18, bestMove: 'e7e5' }),
  }),
}));
vi.mock('./blunderEnrichmentBackfill', () => ({ isMaintenanceRunning: () => false }));
vi.mock('./endgameScenarioVerifier', () => ({ isEndgameVerificationRunning: () => false }));
vi.mock('../state/syncStore', () => ({ isAnySyncInFlight: () => sync.inFlight }));
vi.mock('../lib/queryClient', () => ({ queryClient: { invalidateQueries: async () => {} } }));

const { ApiError } = await import('../lib/api');
const { runSessionEndHooks } = await import('../lib/sessionEnd');
const { startOpeningDeviationScan } = await import('./openingDeviationService');
const { useOpeningScanStore } = await import('../state/openingScanStore');

const FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

function exit(id: string, family: string, color: 'white' | 'black'): OpeningDeviation {
  return {
    id,
    gameId: `g-${id}`,
    status: 'user_left',
    ply: 1,
    moveNumber: 1,
    userColor: color,
    fenBefore: FEN,
    epdBefore: FEN.split(' ').slice(0, 4).join(' '),
    playedUci: 'e7e5',
    playedSan: 'e5',
    reason: 'not_in_book',
    theoryMoves: [],
    positionGames: 100,
    playedGames: 0,
    playedMoverWinPct: null,
    evalBefore: 20,
    evalAfter: null,
    chancesLost: null,
    classification: null,
    evaluatedAt: null,
    bookTier: 'otb',
    bookEndPly: null,
    pastBookCheckedAt: null,
    blunderId: null,
    openingFamily: family,
    openingName: family,
    eco: null,
    createdAt: new Date(0),
  };
}

/** Let the scan's timers and awaits run until `done` holds (or fail after `maxMs`). */
async function runUntil(done: () => boolean, maxMs = 120_000): Promise<void> {
  for (let t = 0; t < maxMs && !done(); t += 250) await vi.advanceTimersByTimeAsync(250);
  expect(done()).toBe(true);
}

beforeEach(() => {
  vi.useFakeTimers();
  // Most-played first, the order the RPC returns: two Sicilians, then one Italian.
  db.pending = [
    exit('s1', 'Sicilian Defense', 'black'),
    exit('s2', 'Sicilian Defense', 'black'),
    exit('i1', 'Italian Game', 'white'),
  ];
  db.scored = [];
  db.groupsAsked = [];
  db.unanalyzed = 0;
  db.signedOut = false;
  db.writeAttempts = 0;
  sync.inFlight = false;
});

afterEach(async () => {
  // Let any pass finish so the module's `running` flag is clear for the next test.
  db.unanalyzed = 0;
  sync.inFlight = false;
  await runUntil(() => useOpeningScanStore.getState().phase === 'done' || useOpeningScanStore.getState().phase === 'stopped');
  vi.useRealTimers();
});

describe('startOpeningDeviationScan', () => {
  it('scores only the most-played opening while sync analysis runs, the rest after', async () => {
    db.unanalyzed = 5;
    sync.inFlight = true;
    startOpeningDeviationScan({ detached: true });

    await runUntil(() => useOpeningScanStore.getState().phase === 'waiting');
    expect(db.scored).toEqual(['s1', 's2']);
    expect(db.groupsAsked.filter(Boolean)).toContainEqual({ family: 'Sicilian Defense', color: 'black' });

    // Sync analysis finishes: the Italian exit is scored next.
    db.unanalyzed = 0;
    sync.inFlight = false;
    await runUntil(() => useOpeningScanStore.getState().phase === 'done');
    expect(db.scored).toEqual(['s1', 's2', 'i1']);
  });

  it('with sync idle, scores every opening most-played first', async () => {
    startOpeningDeviationScan({ detached: true });
    await runUntil(() => useOpeningScanStore.getState().phase === 'done');
    expect(db.scored).toEqual(['s1', 's2', 'i1']);
    expect(db.groupsAsked.every((g) => g === null)).toBe(true);
  });

  it('a page-held pass stops when the page leaves; a detached one keeps going', async () => {
    db.unanalyzed = 5;
    sync.inFlight = true;
    const release = startOpeningDeviationScan();
    await runUntil(() => db.scored.length === 2);
    release();
    expect(useOpeningScanStore.getState().phase).toBe('stopped');

    // Detached (sync finished): survives a page coming and going.
    db.unanalyzed = 0;
    sync.inFlight = false;
    startOpeningDeviationScan({ detached: true });
    const releasePage = startOpeningDeviationScan();
    releasePage();
    await runUntil(() => useOpeningScanStore.getState().phase === 'done');
    expect(db.scored).toEqual(['s1', 's2', 'i1']);
  });

  it('a detached pass waiting on games nobody analyzes gives up instead of polling forever', async () => {
    db.pending = [];
    db.unanalyzed = 3; // leftovers, but no sync running and no page open
    startOpeningDeviationScan({ detached: true });
    await runUntil(() => useOpeningScanStore.getState().phase === 'waiting');
    await runUntil(() => useOpeningScanStore.getState().phase === 'stopped', 180_000);
  });

  it('sign-out ends a detached pass and clears its progress; the next sign-in starts fresh', async () => {
    db.unanalyzed = 5;
    sync.inFlight = true;
    startOpeningDeviationScan({ detached: true });
    await runUntil(() => useOpeningScanStore.getState().phase === 'waiting');
    expect(db.scored).toEqual(['s1', 's2']);

    runSessionEndHooks();
    expect(useOpeningScanStore.getState()).toMatchObject({ phase: 'idle', unscored: 0, unanalyzed: 0 });
    const asked = db.groupsAsked.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(db.groupsAsked.length).toBe(asked);
    expect(useOpeningScanStore.getState().phase).toBe('idle');

    db.unanalyzed = 0;
    sync.inFlight = false;
    startOpeningDeviationScan({ detached: true });
    await runUntil(() => useOpeningScanStore.getState().phase === 'done');
    expect(db.scored).toEqual(['s1', 's2', 'i1']);
  });

  it('a 401 ends the pass at the first row instead of failing every row', async () => {
    db.signedOut = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startOpeningDeviationScan({ detached: true });
    await runUntil(() => useOpeningScanStore.getState().phase === 'stopped');
    expect(db.writeAttempts).toBe(1);
    warn.mockRestore();
  });
});
