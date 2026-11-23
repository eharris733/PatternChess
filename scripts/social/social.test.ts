import { describe, expect, it, vi } from 'vitest';
import { DUCK_GAIN, renderWav, SAMPLE_RATE } from './audio.ts';
import { createPostInput, createVideoPost } from './buffer.ts';
import { endCardLines, instagramCaption, ratingLabel, templateScript, tiktokCaption } from './copy.ts';
import { judge, judgeTrap, parseInfo } from './engine.ts';
import { shortcodeOf } from './instagram.ts';
import { addDays, emptySlots, formatForDay } from './plan.ts';
import { publishDay } from './publish.ts';
import {
  buildFallPuzzle,
  buildPuzzle,
  candidateScore,
  epdOf,
  isCandidate,
  pickMotif,
  trimRefutation,
  trimSolution,
  type BlunderRow,
} from './puzzle.ts';
import { buildFacts, validateScript, type VideoScript } from './script.ts';
import { fallScore, nextCandidate, trapBlunderId } from './select.ts';
import { pronounce, spokenSan } from './spoken.ts';
import { COUNTDOWN_SECONDS, frameAt, frameCount, schedule, type VoiceTiming } from './timeline.ts';
import { chunkWords, normalize, resample, sentences, timeWords, trimSilence } from './voice.ts';

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

// 1.e4 e5 2.Qh5 g6?? 3.Qxe5+ Qe7 4.Qxh8 (11 players), right move 2...Nc6.
const QH5_FEN = 'rnbqkbnr/pppp1ppp/8/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2';
const FALL = buildFallPuzzle({
  blunderId: 'trap:x',
  fen: QH5_FEN,
  tempting: 'g7g6',
  fellCount: 11,
  refutationPv: ['h5e5', 'd8e7', 'e5h8', 'g8f6', 'h8h7'],
  bestPv: ['b8c6', 'f1c4', 'g7g6'],
  bestCp: 20,
})!;

describe('puzzle', () => {
  it('builds a mate puzzle and stops the line at mate', () => {
    const p = buildPuzzle(MATE_ROW)!;
    expect(p).not.toBeNull();
    expect(p.format).toBe('blunder');
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

describe('fall format', () => {
  it('builds the trap: tempting move, the punishment to the last capture, the right move', () => {
    expect(FALL.format).toBe('fall');
    expect(FALL.side).toBe('black');
    expect(FALL.played.san).toBe('g6');
    // Five plies, ending on the punisher's last capture (Qxh7).
    expect(FALL.refutation.map((r) => r.san)).toEqual(['Qxe5+', 'Qe7', 'Qxh8', 'Nf6', 'Qxh7']);
    expect(FALL.solution.map((s) => s.san)).toEqual(['Nc6']); // not winning → just the move
    expect(FALL.fellCount).toBe(11);
    expect(FALL.trapKey).toBe(`${epdOf(QH5_FEN)}|g7g6`);
  });

  it('trims the punishment back to the opponent’s last capture or check', () => {
    const after = 'rnbqkbnr/pppp1p1p/6p1/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 0 3';
    expect(trimRefutation(after, ['h5e5', 'd8e7', 'e5h8', 'g8f6']).map((r) => r.san)).toEqual(['Qxe5+', 'Qe7', 'Qxh8']);
    expect(trimRefutation(after, ['h5e5', 'f8e7', 'b1c3']).map((r) => r.san)).toEqual(['Qxe5+']);
  });

  it('refuses a trap whose tempting move is the best move', () => {
    expect(buildFallPuzzle({ blunderId: 'x', fen: QH5_FEN, tempting: 'b8c6', fellCount: 3, refutationPv: ['f1c4'], bestPv: ['b8c6'], bestCp: 0 })).toBeNull();
  });

  it('judges a trap on the winning chances it throws away', () => {
    const best = { move: 'b8c6', cp: -20, pv: ['b8c6'] };
    expect(judgeTrap('g7g6', best, { move: 'h5e5', cp: 600, pv: ['h5e5'] })).toMatchObject({ ok: true });
    expect(judgeTrap('g7g6', best, { move: 'h5e5', cp: 40, pv: ['h5e5'] })).toMatchObject({ ok: false });
    expect(judgeTrap('b8c6', best, { move: 'f1c4', cp: 20, pv: ['f1c4'] })).toMatchObject({ ok: false });
    expect(judgeTrap('g7g6', undefined, undefined)).toMatchObject({ ok: false });
  });

  it('keys traps by position, not move counters, and ranks openings first', () => {
    expect(epdOf('8/8/8/8/8/8/8/K6k w - e3 12 40')).toBe('8/8/8/8/8/8/8/K6k w - e3');
    expect(trapBlunderId('a|b')).toBe('trap:a|b');
    expect(fallScore({ players: 5, move_number: 4 })).toBeGreaterThan(fallScore({ players: 7, move_number: 30 }));
  });

  it('alternates formats by day', () => {
    expect(formatForDay('2026-11-23')).not.toBe(formatForDay('2026-11-24'));
    expect(new Set([0, 1, 2, 3].map((i) => formatForDay(addDays('2026-11-23', i))))).toEqual(new Set(['blunder', 'fall']));
  });
});

describe('spoken', () => {
  it('says moves the way a narrator would', () => {
    expect(spokenSan('Qxh7+')).toBe('queen takes h7, check');
    expect(spokenSan('Rh3#')).toBe('rook h3, checkmate');
    expect(spokenSan('exd5')).toBe('e takes d5');
    expect(spokenSan('e4')).toBe('e4');
    expect(spokenSan('Nbd7')).toBe('knight d7');
    expect(spokenSan('O-O-O')).toBe('castles long');
    expect(spokenSan('e8=Q+')).toBe('e8, promotes to a queen, check');
  });
  it('makes the brand sayable', () => {
    expect(pronounce('Try PatternChess at patternchess.com')).toBe('Try Pattern Chess at pattern chess dot com');
  });
});

const goodBlunderScript = (): VideoScript => ({
  hookStyle: 'rating-shame',
  headline: "I'm 2056 and I missed mate",
  subline: 'White to move. Find it.',
  beats: {
    hook: "I'm rated 2056 and I missed mate in 2.",
    challenge: 'Pause. You have 5 seconds.',
    played: 'I played rook takes c2. Greedy.',
    reveal: 'Queen takes h7, check! King takes h7, rook h3 is checkmate.',
    cta: 'PatternChess turns your own blunders into puzzles.',
  },
  captionLead: 'I missed this at 2056 blitz. Did you find it?',
});

describe('script guardrails', () => {
  const p = buildPuzzle(MATE_ROW)!;
  const facts = buildFacts(p, COUNTDOWN_SECONDS);

  it('builds facts with spoken moves and the allow-lists', () => {
    expect(facts.played).toMatchObject({ san: 'Rxc2', spoken: 'rook takes c2', by: 'viewer' });
    expect(facts.solution.map((m) => m.by)).toEqual(['viewer', 'opponent', 'viewer']);
    expect(facts.allowedSquares).toEqual(expect.arrayContaining(['c2', 'h7', 'h3']));
    expect(facts.allowedNumbers).toEqual(expect.arrayContaining([2056, 5, 2]));
    const ff = buildFacts(FALL, COUNTDOWN_SECONDS);
    expect(ff.fellCount).toBe(11);
    expect(ff.rating).toBeNull();
    expect(ff.refutationWins).toBe('the rook');
  });

  it('accepts a clean script', () => {
    const r = validateScript(goodBlunderScript(), facts);
    expect(r.ok, r.ok ? '' : r.errors.join('\n')).toBe(true);
  });

  it('rejects invented numbers, unknown squares, emoji, ELO and insults', () => {
    const bad = (patch: Partial<VideoScript['beats']>, top: Partial<VideoScript> = {}) =>
      validateScript({ ...goodBlunderScript(), ...top, beats: { ...goodBlunderScript().beats, ...patch } }, facts);
    expect(bad({ hook: '90% of players miss this.' })).toMatchObject({ ok: false });
    expect(bad({ hook: 'Only 3 people ever found this.' })).toMatchObject({ ok: false });
    expect(bad({ hook: 'Only seven people ever found this.' })).toMatchObject({ ok: false });
    expect(bad({ reveal: 'Queen takes g7 wins.' })).toMatchObject({ ok: false });
    expect(bad({ hook: 'I hung mate 🔥' })).toMatchObject({ ok: false });
    expect(bad({ hook: 'My ELO is a lie.' })).toMatchObject({ ok: false });
    expect(bad({ hook: 'Only an idiot misses this.' })).toMatchObject({ ok: false });
    expect(bad({ hook: 'Magnus would find this.' })).toMatchObject({ ok: false });
    expect(bad({ cta: 'Follow for more.' })).toMatchObject({ ok: false }); // must name PatternChess
    expect(bad({ refutation: 'Not in this format.' })).toMatchObject({ ok: false });
    expect(bad({}, { headline: 'Queen takes h7 was there all along' })).toMatchObject({ ok: false });
    // Spoilers: the answer may only come in the reveal.
    expect(bad({}, { captionLead: 'Did you spot queen takes h7 in time?' })).toMatchObject({ ok: false });
    expect(bad({ challenge: 'Look at h7. 5 seconds.' })).toMatchObject({ ok: false });
    expect(bad({ played: 'I played rook takes c2 instead of the mate.' })).toMatchObject({ ok: true });
    expect(validateScript({ hookStyle: 'x' }, facts)).toMatchObject({ ok: false });
  });

  it('requires the punishment in the fall format', () => {
    const ff = buildFacts(FALL, COUNTDOWN_SECONDS);
    const t = templateScript(FALL, COUNTDOWN_SECONDS);
    expect(validateScript(t, ff)).toMatchObject({ ok: true });
    expect(validateScript({ ...t, beats: { ...t.beats, refutation: undefined } }, ff)).toMatchObject({ ok: false });
    expect(validateScript({ ...t, beats: { ...t.beats, hook: '12 PatternChess players fell for this.' } }, ff)).toMatchObject({ ok: false });
  });

  it('template scripts always pass their own checks', () => {
    for (const row of [MATE_ROW, { ...MATE_ROW, id: 'b2' }, { ...MATE_ROW, id: 'b3', user_rating: null, time_category: null }]) {
      const q = buildPuzzle(row)!;
      const r = validateScript(templateScript(q, COUNTDOWN_SECONDS), buildFacts(q, COUNTDOWN_SECONDS));
      expect(r.ok, r.ok ? '' : r.errors.join('\n')).toBe(true);
    }
  });
});

describe('copy', () => {
  const p = buildPuzzle(MATE_ROW)!;
  it('writes captions without the opponent, with Elo-free rating text', () => {
    expect(ratingLabel(p)).toBe('2056 blitz');
    const s = goodBlunderScript();
    const ig = instagramCaption(p, s);
    expect(ig).toContain(s.captionLead);
    expect(ig).toContain('White to move. Comment your move before the reveal.');
    expect(ig).not.toContain('games at 2056'); // the lead already says it
    expect(instagramCaption(p, { ...s, captionLead: 'Find it.' })).toContain('From one of my own blitz games at 2056.');
    expect(ig).toContain('#checkmate');
    expect(ig).not.toMatch(/ELO|elo\b/);
    const tt = tiktokCaption(p, s);
    expect(tt).toContain('patternchess.com');
    expect(tt).toContain('#chesstok');
    expect(tt).not.toContain('Link in bio');
  });
  it('tags and pitches the fall format as traps', () => {
    const t = templateScript(FALL, COUNTDOWN_SECONDS);
    expect(instagramCaption(FALL, t)).toContain('#chesstrap');
    expect(instagramCaption(FALL, t)).not.toContain('From one of my own');
    expect(endCardLines(FALL)[0]).toBe('Find the traps you fall for');
  });
  it('degrades when rating / time control are unknown', () => {
    const q = { ...p, rating: null, timeControl: null };
    const t = templateScript(q, COUNTDOWN_SECONDS);
    expect(JSON.stringify(t)).not.toMatch(/null|undefined|  /);
    expect(instagramCaption(q, { ...t, captionLead: 'Find it.' })).toContain('From one of my own games.');
  });
});

/** A fake narration: `seconds` long, one caption chunk. */
const narr = (seconds: number, text = 'one two three') => {
  const words = text.split(' ');
  return {
    duration: seconds,
    phrases: [
      {
        start: 0,
        end: seconds,
        words: words.map((w, i) => ({ text: w, start: (i * seconds) / words.length, end: ((i + 1) * seconds) / words.length })),
      },
    ],
  };
};

describe('timeline', () => {
  const p = buildPuzzle(MATE_ROW)!;
  const s = schedule(p);
  it('shows the board and hook from the first frame, then counts down', () => {
    expect(frameAt(s, 0)).toMatchObject({ stage: 'hook', fen: p.fen, countdown: null, endCard: false, caption: null });
    expect(frameAt(s, 1.5)).toMatchObject({ stage: 'countdown', countdown: { left: COUNTDOWN_SECONDS } });
    expect(frameAt(s, 1 + COUNTDOWN_SECONDS - 0.1).countdown?.left).toBe(1);
  });
  it('shows the played move in red, then the line, ending on mate', () => {
    const played = frameAt(s, 1 + COUNTDOWN_SECONDS + 0.1);
    expect(played).toMatchObject({ stage: 'played', status: { tone: 'bad', text: 'What I played: Rxc2' } });
    expect(played.arrow).toMatchObject({ from: 'f2', to: 'c2' });
    const reveal = s.segments.filter((x) => x.frame.stage === 'reveal');
    expect(reveal.at(-1)?.frame.fen).toBe(p.solution.at(-1)!.fen);
    expect(reveal.at(-1)?.frame.badge).toMatchObject({ text: '#' });
    expect(reveal[0].frame.status.text).toBe('The winning move · Missed mate');
  });
  it('ends on the start position so the loop is seamless', () => {
    const end = frameAt(s, s.duration - 0.01);
    expect(end).toMatchObject({ stage: 'end', fen: p.fen, endCard: true, arrow: null });
    expect(frameCount(s)).toBe(Math.round(s.duration * 30));
  });
  it('cues a tick per countdown second and a chime at the reveal', () => {
    expect(s.cues.filter((c) => c.kind === 'tick' || c.kind === 'tickLast')).toHaveLength(COUNTDOWN_SECONDS);
    expect(s.cues.filter((c) => c.kind === 'chime')).toHaveLength(1);
  });

  it('stretches each scene to its narration and places the captions', () => {
    const voice: VoiceTiming = { hook: narr(3), challenge: narr(1.5), played: narr(4), reveal: narr(5), cta: narr(3.5) };
    const v = schedule(p, voice);
    expect(v.duration).toBeGreaterThan(s.duration + 5);
    const at = (b: string) => v.voice.find((x) => x.beat === b)!.t;
    expect(at('hook')).toBe(0);
    expect(at('challenge')).toBeCloseTo(3.3); // after the hook's narration + tail
    expect(at('played')).toBeGreaterThanOrEqual(at('challenge') + COUNTDOWN_SECONDS);
    // Nothing talks over the next scene: each beat starts after the previous one ended.
    const order = ['hook', 'challenge', 'played', 'reveal', 'cta'];
    order.slice(1).forEach((b, i) => expect(at(b)).toBeGreaterThanOrEqual(at(order[i]) + voice[order[i] as keyof VoiceTiming]!.duration));
    expect(frameAt(v, 0.1).caption).toEqual({ words: ['one', 'two', 'three'], active: 0 });
    expect(frameAt(v, 2.5).caption?.active).toBe(2);
    expect(frameAt(v, at('played') + 0.1).stage).toBe('played');
  });

  it('plays the punishment between the tempting move and the right move (fall)', () => {
    const f = schedule(FALL);
    const stages = [...new Set(f.segments.map((x) => x.frame.stage))];
    expect(stages).toEqual(['hook', 'countdown', 'played', 'refutation', 'reveal', 'end']);
    const ref = f.segments.filter((x) => x.frame.stage === 'refutation');
    expect(ref.at(-1)?.frame.fen).toBe(FALL.refutation.at(-1)!.fen);
    expect(ref[0].frame.status).toEqual({ text: 'The punishment', tone: 'bad' });
    const played = f.segments.find((x) => x.frame.stage === 'played')!;
    expect(played.frame.status.text).toBe('Most people play g6');
    // The reveal starts back on the trap position.
    expect(f.segments.find((x) => x.frame.stage === 'reveal')!.frame.fen).toBe(QH5_FEN);
  });
});

describe('voice', () => {
  it('splits sentences and caption chunks', () => {
    expect(sentences('I played c2. Wrong! Really?')).toEqual(['I played c2.', 'Wrong!', 'Really?']);
    expect(chunkWords('Queen takes h7, check and rook h3 mates')).toEqual([
      ['Queen', 'takes', 'h7,'],
      ['check', 'and', 'rook', 'h3', 'mates'],
    ]);
    expect(chunkWords('one two three four five').map((c) => c.length)).toEqual([5]); // a lone last word joins
    expect(chunkWords('a b c d e f g').map((c) => c.length)).toEqual([4, 3]);
  });
  it('spreads word timings over the sentence', () => {
    const ph = timeWords('Pause now, find it.', 1, 2);
    expect(ph[0].start).toBe(1);
    expect(ph.at(-1)!.end).toBeCloseTo(3);
    for (const p of ph) for (const w of p.words) expect(w.end).toBeGreaterThan(w.start);
  });
  it('resamples, trims silence and normalizes', () => {
    expect(resample(new Float32Array(24000), 24000, 44100).length).toBe(44100);
    const s = new Float32Array(1000);
    s.fill(0.5, 400, 600);
    expect(trimSilence(s, 1000).length).toBe(200 + 2 * 30);
    const n = Float32Array.from([0.1, -0.2]);
    normalize(n, 0.8);
    expect(Math.max(...n.map(Math.abs))).toBeCloseTo(0.8);
  });
});

describe('audio', () => {
  it('writes a mono 16-bit WAV of the right length', () => {
    const wav = renderWav([{ t: 0.1, kind: 'tick' }, { t: 0.5, kind: 'chime' }], 2);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(SAMPLE_RATE);
    expect(wav.length).toBe(44 + Math.ceil(2 * SAMPLE_RATE) * 2);
  });
  it('mixes the narration in and ducks the effects under it', () => {
    const tick = renderWav([{ t: 0.5, kind: 'tick' }], 1);
    const voiceClip = new Float32Array(SAMPLE_RATE); // silent narration over the whole second
    const ducked = renderWav([{ t: 0.5, kind: 'tick' }], 1, [{ t: 0, samples: voiceClip }]);
    const peak = (b: Buffer) => {
      let m = 0;
      for (let i = 44; i < b.length; i += 2) m = Math.max(m, Math.abs(b.readInt16LE(i)));
      return m;
    };
    expect(peak(ducked) / peak(tick)).toBeCloseTo(DUCK_GAIN, 1);
    const loud = renderWav([], 1, [{ t: 0.2, samples: Float32Array.from({ length: 100 }, () => 0.5) }]);
    expect(peak(loud)).toBeGreaterThan(10000);
  });
});

describe('engine', () => {
  it('parses scored info lines (with the full PV) and skips bounds', () => {
    expect(parseInfo('info depth 20 seldepth 30 multipv 2 score cp -45 nodes 1 pv e2e4 e7e5')).toEqual({
      multipv: 2,
      depth: 20,
      line: { move: 'e2e4', cp: -45, pv: ['e2e4', 'e7e5'] },
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

describe('buffer', () => {
  const base = { channelId: 'ch1', text: 'Caption', videoUrl: 'https://social.patternchess.com/reels/a.mp4', dueAt: '2026-11-24T17:10:00.000Z', draft: false };
  it('builds a Reel for Instagram and a plain video post for TikTok', () => {
    expect(createPostInput({ ...base, channel: 'instagram' })).toEqual({
      channelId: 'ch1',
      text: 'Caption',
      schedulingType: 'automatic',
      mode: 'customScheduled',
      dueAt: base.dueAt,
      assets: [{ video: { url: base.videoUrl, metadata: { thumbnailOffset: 500 } } }],
      metadata: { instagram: { type: 'reel', shouldShareToFeed: true } },
    });
    const tt = createPostInput({ ...base, channel: 'tiktok', draft: true });
    expect(tt).not.toHaveProperty('metadata');
    expect(tt).toMatchObject({ saveToDraft: true });
  });
  it('returns the post or throws Buffer’s error', async () => {
    process.env.BUFFER_API_KEY = 'test-key';
    const ok = vi.fn(async () => new Response(JSON.stringify({ data: { createPost: { __typename: 'PostActionSuccess', post: { id: 'p1', status: 'scheduled' } } } })));
    await expect(createVideoPost({ ...base, channel: 'instagram' }, ok as unknown as typeof fetch)).resolves.toEqual({ id: 'p1', status: 'scheduled' });
    const call = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect((call[1].headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    expect(JSON.parse(call[1].body as string).variables.input.channelId).toBe('ch1');
    const bad = vi.fn(async () => new Response(JSON.stringify({ data: { createPost: { __typename: 'InvalidInputError', message: 'bad video' } } })));
    await expect(createVideoPost({ ...base, channel: 'tiktok' }, bad as unknown as typeof fetch)).rejects.toThrow(/InvalidInputError: bad video/);
    const gql = vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: 'nope', extensions: { code: 'UNAUTHORIZED' } }] }), { status: 401 }));
    await expect(createVideoPost({ ...base, channel: 'tiktok' }, gql as unknown as typeof fetch)).rejects.toThrow(/UNAUTHORIZED: nope/);
  });
  it('finds the Instagram shortcode Buffer links to', () => {
    expect(shortcodeOf('https://www.instagram.com/reel/DeJYa-egCjC/')).toBe('DeJYa-egCjC');
    expect(shortcodeOf('https://www.instagram.com/patternchess/p/abc_1/')).toBe('abc_1');
    expect(shortcodeOf('https://example.com/x')).toBeNull();
  });
});

describe('publish day', () => {
  it('previews another day only in draft or dry mode', () => {
    expect(publishDay('live', null, '2026-11-23')).toBe('2026-11-23');
    expect(publishDay('draft', '2026-11-24', '2026-11-23')).toBe('2026-11-24');
    expect(publishDay('dry', '2026-11-24', '2026-11-23')).toBe('2026-11-24');
    expect(publishDay('live', '2026-11-23', '2026-11-23')).toBe('2026-11-23');
    expect(() => publishDay('live', '2026-11-24', '2026-11-23')).toThrow(/live only posts today/);
    expect(() => publishDay('draft', 'tomorrow', '2026-11-23')).toThrow(/YYYY-MM-DD/);
  });
});

describe('plan', () => {
  it('fills tomorrow onward, skipping taken days and never today', () => {
    expect(emptySlots('2026-11-22', 3, new Set(['2026-11-24']))).toEqual(['2026-11-23', '2026-11-25']);
    expect(emptySlots('2026-11-22', 3, new Set())).not.toContain('2026-11-22');
  });
});
