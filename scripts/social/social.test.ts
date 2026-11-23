import { describe, expect, it } from 'vitest';
import { renderWav, SAMPLE_RATE } from './audio.ts';
import { HOOKS, hookForDay, instagramCaption, ratingLabel, tiktokCaption } from './copy.ts';
import { judge, parseInfo } from './engine.ts';
import { addDays, emptySlots } from './plan.ts';
import { buildPuzzle, candidateScore, isCandidate, pickMotif, trimSolution, type BlunderRow } from './puzzle.ts';
import { nextCandidate } from './select.ts';
import { COUNTDOWN_SECONDS, HOOK_END, frameAt, frameCount, schedule } from './timeline.ts';

// From a real row: Qxh7+ Kxh7 Rh3# (White to move; played Rxc2 instead).
const MATE_ROW: BlunderRow = {
  id: 'b1',
  fen: '5rrk/pp3p1p/4bPpQ/n2p4/3P2P1/4BR2/P1r2RKP/3q4 w - - 0 30',
  move_number: 30,
  played_move: 'f2c2',
  correct_moves: [{ move: 'h6h7', eval: 9997 }],
  eval_before: 9997,
  eval_after: 900,
  eval_swing: 100,
  side_to_move: 'white',
  solution_line: { pv: ['h6h7', 'h8h7', 'f3h3'], playedPv: [] },
  motifs: ['allowedFork', 'missedMate'],
  user_rating: 2056,
  time_category: 'blitz',
};

describe('puzzle', () => {
  it('builds a mate puzzle and stops the line at mate', () => {
    const p = buildPuzzle(MATE_ROW)!;
    expect(p).not.toBeNull();
    expect(p.solution.map((s) => s.san)).toEqual(['Qxh7+', 'Kxh7', 'Rh3#']);
    expect(p.played.san).toBe('Rxc2');
    expect(p.motif).toBe('missedMate');
    expect(p.motifLabel).toBe('Missed mate');
    expect(p.mate).toBe(true);
  });

  it('trims a quiet tail and always ends on the mover', () => {
    // 1.e4 e5 2.Nf3 Nc6 3.Bb5: no captures or checks → just the first move.
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    expect(trimSolution(start, ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5']).map((p) => p.san)).toEqual(['e4']);
    // Stops at three user moves.
    expect(trimSolution(start, ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5c6']).length).toBeLessThanOrEqual(5);
  });

  it('rejects rows that cannot make a clean video', () => {
    expect(buildPuzzle({ ...MATE_ROW, played_move: 'h6h7' })).toBeNull(); // played the best move
    expect(buildPuzzle({ ...MATE_ROW, solution_line: { pv: ['a1a8'] }, correct_moves: [{ move: 'a1a8', eval: 900 }] })).toBeNull();
    expect(isCandidate({ ...MATE_ROW, correct_moves: [{ move: 'h6h7', eval: 120 }] })).toBe(false); // no real win
    expect(isCandidate({ ...MATE_ROW, motifs: ['allowedFork'] })).toBe(false); // nothing "missed"
    expect(isCandidate({ ...MATE_ROW, move_number: 5 })).toBe(false);
    expect(isCandidate(MATE_ROW)).toBe(true);
  });

  it('picks the most showable motif and scores mates first', () => {
    expect(pickMotif(['hangingPiece', 'missedFork'])).toBe('missedFork');
    expect(pickMotif(['allowedMate'])).toBeNull();
    expect(candidateScore(MATE_ROW)).toBeGreaterThan(candidateScore({ ...MATE_ROW, motifs: ['hangingPiece'] }));
  });

  it('never runs the same motif two days in a row when it can help it', () => {
    const fork = { ...MATE_ROW, id: 'f', motifs: ['missedFork'] };
    const mate = { ...MATE_ROW, id: 'm' };
    const pool = [mate, fork];
    expect(nextCandidate(pool, 'missedMate')?.id).toBe('f');
    expect(nextCandidate(pool, 'missedMate')?.id).toBe('m'); // only mates left
    expect(nextCandidate(pool, null)).toBeNull();
  });
});

describe('copy', () => {
  const p = buildPuzzle(MATE_ROW)!;
  it('rotates hooks by day', () => {
    const ids = [0, 1, 2, 3].map((i) => hookForDay(addDays('2026-11-23', i)).id);
    expect(new Set(ids).size).toBe(HOOKS.length);
  });
  it('writes captions without the opponent, with Elo-free rating text', () => {
    expect(ratingLabel(p)).toBe('2056 blitz');
    const ig = instagramCaption(p, HOOKS[0]);
    expect(ig).toContain('I blundered this at 2056 blitz. Can you find what I missed?');
    expect(ig).toContain('White to move. Comment your move before the reveal.');
    expect(ig).not.toContain('games at 2056'); // the hook already says it
    expect(instagramCaption(p, HOOKS[2])).toContain('From one of my own blitz games at 2056.');
    expect(ig).toContain('#checkmate');
    expect(ig).not.toMatch(/ELO|elo\b/);
    const tt = tiktokCaption(p, HOOKS[1]);
    expect(tt).toContain('patternchess.com');
    expect(tt).toContain('#chesstok');
    expect(tt).not.toContain('Link in bio');
  });
  it('degrades when rating / time control are unknown', () => {
    const q = { ...p, rating: null, timeControl: null };
    for (const h of HOOKS) {
      expect(h.line1(q)).not.toMatch(/null|undefined|  /);
    }
    expect(instagramCaption(q, HOOKS[0])).toContain('From one of my own games.');
  });
});

describe('timeline', () => {
  const p = buildPuzzle(MATE_ROW)!;
  const s = schedule(p);
  it('shows the board and hook from the first frame, then counts down', () => {
    expect(frameAt(s, 0)).toMatchObject({ stage: 'hook', fen: p.fen, countdown: null, endCard: false });
    expect(frameAt(s, HOOK_END + 0.5)).toMatchObject({ stage: 'countdown', countdown: { left: COUNTDOWN_SECONDS } });
    expect(frameAt(s, HOOK_END + COUNTDOWN_SECONDS - 0.1).countdown?.left).toBe(1);
  });
  it('shows the played move in red, then the line, ending on mate', () => {
    const played = frameAt(s, HOOK_END + COUNTDOWN_SECONDS + 0.1);
    expect(played).toMatchObject({ stage: 'played', status: { tone: 'bad' } });
    expect(played.arrow).toMatchObject({ from: 'f2', to: 'c2' });
    const reveal = s.segments.filter((x) => x.frame.stage === 'reveal');
    expect(reveal.at(-1)?.frame.fen).toBe(p.solution.at(-1)!.fen);
    expect(reveal.at(-1)?.frame.badge).toMatchObject({ text: '#' });
    expect(reveal[0].frame.status.text).toBe('The winning move · Missed mate');
  });
  it('ends on the start position so the loop is seamless', () => {
    const end = frameAt(s, s.duration - 0.01);
    expect(end).toMatchObject({ stage: 'end', fen: p.fen, endCard: true, arrow: null });
    expect(s.duration).toBeGreaterThan(11);
    expect(s.duration).toBeLessThan(17);
    expect(frameCount(s)).toBe(Math.round(s.duration * 30));
  });
  it('cues a tick per countdown second and a chime at the reveal', () => {
    expect(s.cues.filter((c) => c.kind === 'tick' || c.kind === 'tickLast')).toHaveLength(COUNTDOWN_SECONDS);
    expect(s.cues.filter((c) => c.kind === 'chime')).toHaveLength(1);
  });
});

describe('audio', () => {
  it('writes a mono 16-bit WAV of the right length', () => {
    const wav = renderWav([{ t: 0.1, kind: 'tick' }, { t: 0.5, kind: 'chime' }], 2);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(SAMPLE_RATE);
    expect(wav.length).toBe(44 + Math.ceil(2 * SAMPLE_RATE) * 2);
  });
});

describe('engine', () => {
  it('parses scored info lines and skips bounds', () => {
    expect(parseInfo('info depth 20 seldepth 30 multipv 2 score cp -45 nodes 1 pv e2e4 e7e5')).toEqual({
      multipv: 2,
      depth: 20,
      line: { move: 'e2e4', cp: -45 },
    });
    expect(parseInfo('info depth 20 multipv 1 score mate 3 pv h6h7')?.line.cp).toBe(9997);
    expect(parseInfo('info depth 20 multipv 1 score mate -2 pv a1a2')?.line.cp).toBe(-9998);
    expect(parseInfo('info depth 20 multipv 1 score cp 50 lowerbound pv e2e4')).toBeNull();
    expect(parseInfo('info string NNUE enabled')).toBeNull();
  });
  it('accepts only one clearly winning answer', () => {
    expect(judge('h6h7', [{ move: 'h6h7', cp: 9997 }, { move: 'f3f7', cp: 50 }]).ok).toBe(true);
    expect(judge('h6h7', [{ move: 'h6h7', cp: 9997 }])).toMatchObject({ ok: true });
    expect(judge('h6h7', [{ move: 'h6h7', cp: 9997 }, { move: 'f3h3', cp: 9993 }])).toMatchObject({ ok: false });
    expect(judge('h6h7', [{ move: 'f3h3', cp: 9997 }, { move: 'h6h7', cp: 9993 }])).toMatchObject({ ok: false });
    expect(judge('a1a8', [{ move: 'a1a8', cp: 120 }, { move: 'b1b8', cp: -300 }])).toMatchObject({ ok: false }); // not winning
    expect(judge('a1a8', [{ move: 'a1a8', cp: 900 }, { move: 'b1b8', cp: 600 }])).toMatchObject({ ok: false }); // both win
  });
});

describe('plan', () => {
  it('fills tomorrow onward, skipping taken days and never today', () => {
    expect(emptySlots('2026-11-22', 3, new Set(['2026-11-24']))).toEqual(['2026-11-23', '2026-11-25']);
    expect(emptySlots('2026-11-22', 3, new Set())).not.toContain('2026-11-22');
  });
});
