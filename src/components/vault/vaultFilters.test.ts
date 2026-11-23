import { describe, expect, it } from 'vitest';
import { blunderFromJson } from '../../models/blunder';
import { gameRecordFromJson } from '../../models/gameRecord';
import {
  activeFilterCount,
  clearFilterParams,
  EMPTY_FILTERS,
  effectiveFilters,
  facetCounts,
  matchesFilters,
  openingOptions,
  positionFacts,
  readFilters,
  writeFilters,
} from './vaultFilters';

function blunder(over: Record<string, unknown>) {
  return blunderFromJson({
    id: 'b',
    game_id: 'g1',
    fen: 'r1bqkb1r/ppp2ppp/2n2n2/3Pp1N1/2B5/8/PPPP1PPP/RNBQK2R b KQkq - 0 5',
    move_number: 5,
    played_move: 'f6d5',
    correct_moves: [{ move: 'c6a5', eval: -40 }],
    eval_before: 0,
    eval_after: -300,
    eval_swing: 300,
    side_to_move: 'b',
    created_at: '2026-03-01T12:00:00Z',
    phase: 'middlegame',
    motifs: [],
    kind: 'tactic',
    ...over,
  });
}

function game(over: Record<string, unknown>) {
  return gameRecordFromJson({
    id: 'g1',
    platform: 'lichess',
    username: 'hero',
    opponent: 'villain',
    created_at: '2026-01-01T00:00:00Z',
    played_at: '2026-02-10T12:00:00Z',
    user_color: 'black',
    opening_family: 'Italian Game',
    ...over,
  });
}

describe('readFilters / writeFilters', () => {
  it('reads valid values and ignores unknown ones', () => {
    const f = readFilters(
      new URLSearchParams(
        'type=endgame&progress=tryAgain&motif=missedFork&phase=endgame&opening=Sicilian%20Defense&color=black&from=2026-01-01&to=2026-02-30x',
      ),
    );
    expect(f).toEqual({
      kind: 'endgame',
      progress: 'tryAgain',
      motif: 'missedFork',
      phase: 'endgame',
      opening: 'Sicilian Defense',
      color: 'black',
      from: '2026-01-01',
      to: null,
    });
    expect(readFilters(new URLSearchParams('motif=toString&phase=late&color=red&type=__proto__'))).toEqual(
      EMPTY_FILTERS,
    );
  });

  it('round-trips through the URL and keeps unrelated params', () => {
    const base = new URLSearchParams('tab=mastered&motif=missedPin');
    const next = writeFilters(base, { phase: 'opening', motif: null, from: '2026-05-01' });
    expect(next.get('tab')).toBe('mastered');
    expect(next.has('motif')).toBe(false);
    expect(readFilters(next)).toMatchObject({ phase: 'opening', from: '2026-05-01', motif: null });
    expect(base.get('motif')).toBe('missedPin'); // not mutated
    const cleared = clearFilterParams(next);
    expect([...cleared.keys()]).toEqual(['tab']);
  });

  it('counts active filters and drops progress on the Mastered tab', () => {
    const f = { ...EMPTY_FILTERS, progress: 'learning' as const, color: 'white' as const };
    expect(activeFilterCount(f)).toBe(2);
    expect(effectiveFilters(f, 'mastered').progress).toBeNull();
    expect(effectiveFilters(f, 'blunders').progress).toBe('learning');
  });
});

describe('positionFacts', () => {
  it("uses the game's color, opening family and date", () => {
    const f = positionFacts(blunder({}), game({}));
    expect(f).toMatchObject({ color: 'black', openingFamily: 'Italian Game', ymd: '2026-02-10', bucket: 'new' });
  });

  it('falls back to the side to move and the found date without a game', () => {
    const f = positionFacts(blunder({ game_id: null }), null);
    expect(f.color).toBe('black');
    expect(f.openingFamily).toBeNull();
    expect(f.ymd).toBe('2026-03-01');
  });

  it("prefers an opening drill's own family", () => {
    const b = blunder({
      kind: 'opening',
      phase: 'opening',
      drill_data: { openingFamily: 'French Defense', openingName: null, theoryMoves: [], positionGames: 0, v: 2 },
    });
    expect(positionFacts(b, game({})).openingFamily).toBe('French Defense');
  });
});

describe('matchesFilters + facetCounts', () => {
  const facts = [
    positionFacts(blunder({ id: 'a', motifs: ['missedFork', 'allowedMate'], phase: 'middlegame' }), game({})),
    positionFacts(
      blunder({ id: 'b', motifs: ['missedFork'], phase: 'endgame', kind: 'endgame', cycle_number: 2, times_attempted: 2 }),
      game({ id: 'g2', user_color: 'white', opening_family: 'Sicilian Defense', played_at: '2026-04-01T12:00:00Z' }),
    ),
    positionFacts(blunder({ id: 'c', motifs: [], phase: 'opening' }), game({ played_at: '2025-12-31T12:00:00Z' })),
  ];
  const ids = (filters: typeof EMPTY_FILTERS) =>
    facts.filter((f) => matchesFilters(f, filters)).map((f) => f.blunder.id);

  it('applies each filter', () => {
    expect(ids(EMPTY_FILTERS)).toEqual(['a', 'b', 'c']);
    expect(ids({ ...EMPTY_FILTERS, motif: 'missedFork' })).toEqual(['a', 'b']);
    expect(ids({ ...EMPTY_FILTERS, motif: 'allowedMate' })).toEqual(['a']);
    expect(ids({ ...EMPTY_FILTERS, phase: 'endgame' })).toEqual(['b']);
    expect(ids({ ...EMPTY_FILTERS, kind: 'tactic' })).toEqual(['a', 'c']);
    expect(ids({ ...EMPTY_FILTERS, progress: 'learning' })).toEqual(['b']);
    expect(ids({ ...EMPTY_FILTERS, opening: 'Italian Game' })).toEqual(['a', 'c']);
    expect(ids({ ...EMPTY_FILTERS, color: 'white' })).toEqual(['b']);
    expect(ids({ ...EMPTY_FILTERS, from: '2026-01-01' })).toEqual(['a', 'b']);
    expect(ids({ ...EMPTY_FILTERS, to: '2026-02-10' })).toEqual(['a', 'c']); // inclusive
    expect(ids({ ...EMPTY_FILTERS, from: '2026-01-01', to: '2026-03-31', motif: 'missedFork' })).toEqual(['a']);
  });

  it('counts each option against the other filters only', () => {
    const filters = { ...EMPTY_FILTERS, motif: 'allowedMate' as const, phase: 'middlegame' as const };
    const motifs = facetCounts(facts, filters, 'motif', (f) => f.blunder.motifs);
    // phase=middlegame leaves only "a"; the motif filter itself is ignored.
    expect(Object.fromEntries(motifs)).toEqual({ missedFork: 1, allowedMate: 1 });
    const phases = facetCounts(facts, filters, 'phase', (f) => [f.blunder.phase]);
    expect(Object.fromEntries(phases)).toEqual({ middlegame: 1 });
    const openings = facetCounts(facts, EMPTY_FILTERS, 'opening', (f) => (f.openingFamily ? [f.openingFamily] : []));
    expect(openingOptions(openings)).toEqual([
      ['Italian Game', 2],
      ['Sicilian Defense', 1],
    ]);
  });
});
