import { describe, expect, it } from 'vitest';
import { ALL_COURSES, type Course, type CourseTopic } from './courseCatalog';
import { rankCourses, recommendCourses, type RecommendInput } from './courseRecommend';
import { courseDrillPositions, matchCourseBlunders, type DrillGameMeta } from './courseDrill';
import type { Blunder } from '../models/blunder';

function course(slug: string, topic: CourseTopic): Course {
  return {
    slug,
    title: slug,
    summary: '',
    topic,
    creator: { name: 'C', channelUrl: 'https://www.youtube.com/@c' },
    permission: { status: 'granted', date: null },
    days: [{ day: 1, title: 'd1' }],
  };
}

const CARO = course('caro', { type: 'opening', keys: ['Caro-Kann Defense'], color: 'black' });
const LONDON = course('london', {
  type: 'opening',
  keys: ['London System', "Queen's Pawn Game"],
  color: 'white',
});
const ITALIAN = course('italian', { type: 'opening', keys: ['Italian Game'] });
const FRENCH = course('french', { type: 'opening', keys: ['French Defense'], color: 'black' });
const HANGING = course('hanging', { type: 'motif', keys: ['leftPieceHanging', 'hangingPiece'] });
const FORKS = course('forks', { type: 'motif', keys: ['allowedFork', 'missedFork'] });
const MIDDLE = course('middle', { type: 'phase', keys: ['middlegame'] });
const ROOK = course('rook', { type: 'phase', keys: ['endgame'], endgameType: 'rook' });
const PAWN = course('pawn', { type: 'phase', keys: ['endgame'], endgameType: 'pawn' });
const ALL = [CARO, LONDON, ITALIAN, FRENCH, HANGING, FORKS, MIDDLE, ROOK, PAWN];

const empty: RecommendInput = {
  openings: [],
  motifCounts: {},
  phaseCounts: { opening: 0, middlegame: 0, endgame: 0 },
};

describe('rankCourses', () => {
  it('recommends nothing without data', () => {
    expect(rankCourses(ALL, empty)).toEqual([]);
  });

  it('is colour-aware for opening courses', () => {
    const asWhite: RecommendInput = {
      ...empty,
      openings: [{ family: 'Caro-Kann Defense', color: 'white', games: 40, costlyExits: 5 }],
    };
    expect(rankCourses(ALL, asWhite).map((r) => r.course.slug)).toEqual([]);
    const asBlack: RecommendInput = {
      ...empty,
      openings: [{ family: 'Caro-Kann Defense', color: 'black', games: 40, costlyExits: 5 }],
    };
    const [top] = rankCourses(ALL, asBlack);
    expect(top.course.slug).toBe('caro');
    expect(top.reason).toBe("You've played the Caro-Kann Defense as Black in 40 games, and left theory at a cost in 5.");
  });

  it('matches any of a course key set and a colourless course from either side', () => {
    const input: RecommendInput = {
      ...empty,
      openings: [
        { family: "Queen's Pawn Game", color: 'white', games: 12, costlyExits: 0 },
        { family: 'London System', color: 'white', games: 3, costlyExits: 0 },
        { family: 'Italian Game', color: 'black', games: 6, costlyExits: 0 },
      ],
    };
    const ranked = rankCourses(ALL, input);
    expect(ranked.map((r) => r.course.slug)).toEqual(['london', 'italian']);
    expect(ranked[0].reason).toBe("You've played the Queen's Pawn Game as White in 15 games.");
  });

  it('ignores openings under the minimum games', () => {
    const input = { ...empty, openings: [{ family: 'French Defense', color: 'black' as const, games: 4, costlyExits: 4 }] };
    expect(rankCourses(ALL, input)).toEqual([]);
  });

  it('weighs costly exits: the leaky opening beats the merely popular one', () => {
    const input: RecommendInput = {
      ...empty,
      openings: [
        { family: 'Italian Game', color: 'white', games: 60, costlyExits: 0 },
        { family: 'French Defense', color: 'black', games: 30, costlyExits: 9 },
      ],
    };
    expect(rankCourses(ALL, input).map((r) => r.course.slug)).toEqual(['french', 'italian']);
  });

  it('scores motifs by share and names them with MOTIF_LABEL', () => {
    const input: RecommendInput = {
      ...empty,
      motifCounts: { leftPieceHanging: 20, hangingPiece: 4, allowedFork: 6, defensiveMistake: 30 },
    };
    const ranked = rankCourses(ALL, input);
    expect(ranked.map((r) => r.course.slug)).toEqual(['hanging', 'forks']);
    expect(ranked[0].reason).toBe('"Left a piece hanging" and "Missed hanging piece" tag 24 blunders from your games.');
    expect(ranked[1].reason).toBe('"Allowed fork" tags 6 blunders from your games.');
  });

  it('narrows endgame courses by the endgames you let slip', () => {
    const input: RecommendInput = {
      ...empty,
      phaseCounts: { opening: 5, middlegame: 50, endgame: 45 },
      endgameTypeCounts: { pawn: 3, rook: 0 },
    };
    const slugs = rankCourses(ALL, input).map((r) => r.course.slug);
    expect(slugs).toContain('pawn');
    expect(slugs).not.toContain('rook');
    expect(rankCourses(ALL, input).find((r) => r.course.slug === 'pawn')!.reason).toBe(
      '3 endgames you let slip were pawn endgames.',
    );
  });

  it('falls back to a prior split before the endgame scan has run', () => {
    const input: RecommendInput = { ...empty, phaseCounts: { opening: 0, middlegame: 10, endgame: 10 } };
    const slugs = rankCourses(ALL, input).map((r) => r.course.slug);
    expect(slugs.indexOf('rook')).toBeLessThan(slugs.indexOf('pawn'));
    expect(slugs[0]).toBe('middle');
  });

  it('skips finished courses', () => {
    const input: RecommendInput = {
      ...empty,
      motifCounts: { leftPieceHanging: 10 },
      finished: new Set(['hanging']),
    };
    expect(rankCourses(ALL, input)).toEqual([]);
  });
});

describe('recommendCourses', () => {
  it('keeps at most two of one topic type while others qualify', () => {
    const input: RecommendInput = {
      ...empty,
      openings: [
        { family: 'Caro-Kann Defense', color: 'black', games: 30, costlyExits: 5 },
        { family: 'French Defense', color: 'black', games: 30, costlyExits: 5 },
        { family: 'Italian Game', color: 'white', games: 30, costlyExits: 5 },
      ],
      motifCounts: { allowedFork: 3, defensiveMistake: 97 },
    };
    const top = recommendCourses(ALL, input);
    expect(top).toHaveLength(3);
    expect(top.filter((r) => r.course.topic.type === 'opening')).toHaveLength(2);
    expect(top.map((r) => r.course.slug)).toContain('forks');
  });

  it('fills from the same type when nothing else qualifies', () => {
    const input: RecommendInput = {
      ...empty,
      openings: [
        { family: 'Caro-Kann Defense', color: 'black', games: 30, costlyExits: 5 },
        { family: 'French Defense', color: 'black', games: 20, costlyExits: 5 },
        { family: 'Italian Game', color: 'white', games: 10, costlyExits: 5 },
      ],
    };
    expect(recommendCourses(ALL, input).map((r) => r.course.slug)).toEqual(['caro', 'french', 'italian']);
  });

  it('ranks the real catalog sensibly for a Caro-Kann player', () => {
    const input: RecommendInput = {
      ...empty,
      openings: [
        { family: 'Caro-Kann Defense', color: 'black', games: 80, costlyExits: 12 },
        { family: 'Italian Game', color: 'white', games: 50, costlyExits: 2 },
      ],
      motifCounts: { leftPieceHanging: 30, allowedFork: 10, defensiveMistake: 60 },
      phaseCounts: { opening: 20, middlegame: 70, endgame: 30 },
    };
    const top = recommendCourses(ALL_COURSES, input).map((r) => r.course.slug);
    expect(top[0]).toBe('caro-kann-foundations');
    expect(top).toContain('stop-hanging-pieces');
  });
});

function blunder(p: Partial<Blunder> & { id: string }): Blunder {
  return {
    gameId: 'g1',
    fen: '8/8/8/8/8/8/8/8 w - - 0 1',
    moveNumber: 8,
    playedMove: 'e4',
    correctMoves: [],
    evalBefore: 0,
    evalAfter: 0,
    evalSwing: 100,
    sideToMove: 'white',
    cycleNumber: 0,
    lastDrilledAt: null,
    nextDrillAt: null,
    timesCorrect: 0,
    timesAttempted: 0,
    lastDrillFailed: false,
    createdAt: new Date(0),
    phase: 'opening',
    solutionLine: null,
    motifs: [],
    kind: 'tactic',
    drillData: null,
    analysisDepth: null,
    ...p,
  };
}

describe('courseDrill', () => {
  const games = new Map<string, DrillGameMeta>([
    ['g1', { family: 'Caro-Kann Defense', color: 'black' }],
    ['g2', { family: 'Caro-Kann Defense', color: 'white' }],
    ['g3', { family: 'Italian Game', color: 'white' }],
  ]);

  it('takes opening positions from games in the course opening and colour', () => {
    const bs = [
      blunder({ id: 'a', gameId: 'g1' }),
      blunder({ id: 'b', gameId: 'g1', kind: 'opening' }),
      blunder({ id: 'c', gameId: 'g1', phase: 'middlegame', moveNumber: 30 }),
      blunder({ id: 'd', gameId: 'g2' }),
      blunder({ id: 'e', gameId: 'g3' }),
      blunder({ id: 'f', gameId: 'g1' }),
    ];
    expect(matchCourseBlunders(CARO, bs, games).map((b) => b.id)).toEqual(['a', 'b', 'f']);
  });

  it('widens a thin opening course to early middlegame positions', () => {
    const bs = [
      blunder({ id: 'a', gameId: 'g1' }),
      blunder({ id: 'c', gameId: 'g1', phase: 'middlegame', moveNumber: 18 }),
      blunder({ id: 'late', gameId: 'g1', phase: 'middlegame', moveNumber: 40 }),
    ];
    expect(matchCourseBlunders(CARO, bs, games).map((b) => b.id)).toEqual(['a', 'c']);
  });

  it('matches motifs and endgame types', () => {
    const rookFen = '4k3/8/8/8/8/8/4P3/R3K3 w - - 0 1';
    const pawnFen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
    const bs = [
      blunder({ id: 'fork', motifs: ['allowedFork'], phase: 'middlegame' }),
      blunder({ id: 'rook', fen: rookFen, phase: 'endgame' }),
      blunder({ id: 'pawn-kind', fen: pawnFen, kind: 'endgame', phase: 'endgame' }),
    ];
    expect(matchCourseBlunders(FORKS, bs, games).map((b) => b.id)).toEqual(['fork']);
    expect(matchCourseBlunders(ROOK, bs, games).map((b) => b.id)).toEqual(['rook']);
    expect(matchCourseBlunders(PAWN, bs, games).map((b) => b.id)).toEqual(['pawn-kind']);
  });

  it('orders due and failed positions first and caps the set', () => {
    const now = new Date('2026-11-22T12:00:00Z');
    const later = new Date('2026-12-01T00:00:00Z');
    const bs = [
      blunder({ id: 'not-due', nextDrillAt: later, timesAttempted: 2, evalSwing: 900 }),
      blunder({ id: 'new-small', evalSwing: 50 }),
      blunder({ id: 'new-big', evalSwing: 500 }),
      blunder({ id: 'failed', lastDrillFailed: true, timesAttempted: 1, nextDrillAt: now }),
      blunder({ id: 'due', timesAttempted: 3, nextDrillAt: now }),
    ];
    expect(courseDrillPositions(CARO, bs, games, { now }).map((b) => b.id)).toEqual([
      'failed',
      'due',
      'new-big',
      'new-small',
      'not-due',
    ]);
    expect(courseDrillPositions(CARO, bs, games, { now, limit: 2 })).toHaveLength(2);
  });
});
