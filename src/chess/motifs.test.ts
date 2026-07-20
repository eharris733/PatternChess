import { describe, expect, it } from 'vitest';
import { detectMotifs, parseMotifs, type MotifInput } from './motifs';

function input(overrides: Partial<MotifInput>): MotifInput {
  return {
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    playedMove: 'a2a3',
    solutionPv: [],
    playedRefutationPv: [],
    evalBefore: 200,
    evalAfter: 200,
    ...overrides,
  };
}

describe('detectMotifs', () => {
  it('tags a missed free piece (hangingPiece)', () => {
    // Black queen on h5 is capturable by the g4 pawn and undefended.
    const motifs = detectMotifs(
      input({
        fen: '4k3/8/8/7q/6P1/8/8/4K3 w - - 0 1',
        playedMove: 'e1d1',
        solutionPv: ['g4h5'],
        evalBefore: 800,
        evalAfter: 900,
      }),
    );
    expect(motifs).toContain('hangingPiece');
    expect(motifs).not.toContain('missedMate');
  });

  it('tags an allowed back-rank mate plus the defensive mistake', () => {
    // 1.Rd4?? walks away from the back rank; ...Re1# mates behind the pawns.
    const motifs = detectMotifs(
      input({
        fen: '4r1k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
        playedMove: 'd1d4',
        solutionPv: ['g1f1'],
        playedRefutationPv: ['e8e1'],
        evalBefore: 0,
        evalAfter: 9999,
      }),
    );
    expect(motifs).toContain('allowedMate');
    expect(motifs).toContain('backRankWeakness');
    expect(motifs).toContain('defensiveMistake');
  });

  it('tags a missed knight fork of king and rook', () => {
    const motifs = detectMotifs(
      input({
        fen: 'r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1',
        playedMove: 'e1e2',
        solutionPv: ['d5c7'],
        evalBefore: 400,
        evalAfter: 100,
      }),
    );
    expect(motifs).toContain('missedFork');
  });

  it('tags a missed skewer: check the king, win the queen behind it', () => {
    // 1.Re1+ Kd6 2.Rxe8.
    const motifs = detectMotifs(
      input({
        fen: '4q3/8/8/4k3/8/8/8/R5K1 w - - 0 1',
        playedMove: 'g1f1',
        solutionPv: ['a1e1', 'e5d6', 'e1e8'],
        evalBefore: 900,
        evalAfter: 100,
      }),
    );
    expect(motifs).toContain('missedSkewer');
    expect(motifs).not.toContain('missedFork');
  });

  it('tags a missed absolute pin that wins the pinned piece', () => {
    // Bb5 pins the undefended c6 knight against the king.
    const motifs = detectMotifs(
      input({
        fen: '4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1',
        playedMove: 'e1e2',
        solutionPv: ['f1b5'],
        evalBefore: 300,
        evalAfter: 0,
      }),
    );
    expect(motifs).toContain('missedPin');
  });

  it('tags a missed discovered attack when the departure opens a ray', () => {
    // Nd6+ clears the e-file: Re1 now hits the queen on e7.
    const motifs = detectMotifs(
      input({
        fen: '4k3/4q3/8/8/4N3/8/8/4RK2 w - - 0 1',
        playedMove: 'f1g1',
        solutionPv: ['e4d6'],
        evalBefore: 500,
        evalAfter: 0,
      }),
    );
    expect(motifs).toContain('missedDiscoveredAttack');
  });

  it('tags a trapped piece with no safe square that is then won', () => {
    // The a8 knight hangs to the g2 bishop and both escape squares are
    // covered by pawns; the line collects it.
    const motifs = detectMotifs(
      input({
        fen: 'n6k/8/3P4/P1P5/8/8/6B1/6K1 w - - 0 1',
        playedMove: 'g1h1',
        solutionPv: ['g1f1', 'a8b6', 'a5b6'],
        evalBefore: 300,
        evalAfter: 0,
      }),
    );
    expect(motifs).toContain('trappedPiece');
  });

  it('tags leaving a piece hanging via the refutation line', () => {
    // 1.Bh6?? gxh6 just loses the bishop.
    const motifs = detectMotifs(
      input({
        fen: '4k3/6p1/8/8/8/8/8/2B1K3 w - - 0 1',
        playedMove: 'c1h6',
        solutionPv: ['e1e2'],
        playedRefutationPv: ['g7h6'],
        evalBefore: 150,
        evalAfter: 300,
      }),
    );
    expect(motifs).toContain('leftPieceHanging');
    expect(motifs).not.toContain('defensiveMistake');
  });

  it('reads mate from the evals even without a stored line', () => {
    const motifs = detectMotifs(
      input({ evalBefore: 9998, evalAfter: 9997, solutionPv: [], playedRefutationPv: [] }),
    );
    expect(motifs).toContain('missedMate');
    expect(motifs).toContain('allowedMate');
  });

  it('yields no tactical tags for a quiet line', () => {
    const motifs = detectMotifs(
      input({
        solutionPv: ['e2e4', 'e7e5', 'g1f3'],
        playedMove: 'a2a3',
        playedRefutationPv: ['e7e5'],
        evalBefore: 300,
      }),
    );
    expect(motifs).toEqual([]);
  });
});

describe('parseMotifs', () => {
  it('drops unknown values and non-arrays', () => {
    expect(parseMotifs(['missedFork', 'bogus', 42])).toEqual(['missedFork']);
    expect(parseMotifs(null)).toEqual([]);
    expect(parseMotifs('missedFork')).toEqual([]);
  });
});
