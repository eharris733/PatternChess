import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from '@mliebelt/pgn-parser';
import { chapterFromGame, type ParsedGame } from '../learn/pgnToTree';
import { countChapterMoments, countMoments, useLearnDrillStore } from './learnDrillStore';

// White learner. Intro beat; 1.e4 (quiz, with a sound comment-only sideline
// 1.d4 and a marked trap 1.f3); 1...c5 commented (beat); 2.Nf3 (quiz, note).
const PGN = `[Event "t"]
{ [%ts 0:05] Welcome. }
1. e4 ( 1. d4 { Fine too. } ) ( 1. f3 $6 { Weakens the king. } ) c5 { [%ts 1:00] The Sicilian. }
2. Nf3 { Develop. } Nc6 3. d4 *`;

const chapter = chapterFromGame(
  (parse(PGN, { startRule: 'games' }) as unknown as ParsedGame[])[0],
  0,
);
const s = () => useLearnDrillStore.getState();

describe('learnDrillStore beats', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    s().start(chapter);
  });
  afterEach(() => {
    s().reset();
    vi.useRealTimers();
  });

  it('counts intro, learner moves and commented opponent moves', () => {
    expect(countMoments(chapter)).toBe(5); // intro, e4, c5 note, Nf3, d4
  });

  it('opens on the intro and waits for Continue', () => {
    expect(s().phase).toBe('explain');
    expect(s().message).toBe('Welcome.');
    expect(s().messageTs).toBe(5);
    s().play('e2e4');
    expect(s().path).toHaveLength(0);
    s().next();
    expect(s().phase).toBe('yourMove');
    expect(s().momentsDone).toBe(1);
  });

  it('nudges a sound comment-only sideline without counting a miss', () => {
    s().next();
    s().play('d2d4');
    expect(s().phase).toBe('yourMove');
    expect(s().path).toHaveLength(0);
    expect(s().totalMisses).toBe(0);
    expect(s().message).toBe('Fine too. Good move. Now find the main move.');
  });

  it('rejects a marked trap with its comment', () => {
    s().next();
    s().play('f2f3');
    expect(s().totalMisses).toBe(1);
    expect(s().message).toBe('Weakens the king.');
  });

  it('pauses on a commented opponent move, then on the learner note', () => {
    s().next();
    s().play('e2e4');
    expect(s().momentsDone).toBe(2);
    vi.runAllTimers();
    expect(s().phase).toBe('explain');
    expect(s().message).toBe('The Sicilian.');
    expect(s().messageTs).toBe(60);
    s().next();
    expect(s().momentsDone).toBe(3);
    s().play('g1f3');
    expect(s().phase).toBe('explain');
    expect(s().message).toBe('Develop.');
    s().next();
    expect(s().momentsDone).toBe(4); // the note doesn't count twice
    vi.runAllTimers();
    s().play('d2d4');
    expect(s().phase).toBe('done');
    expect(s().momentsDone).toBe(5);
  });
});

// Variation runs. White learner. Main: 1.e4 e5 2.Nf3 Nc6 3.Bb5 (last note).
// Opponent sidelines: 1...c5 (commented, answered by 2.Nf3 with an accepted
// alternative 2.Nc3 that runs on) and 2...d6 (commented, no continuation).
const RUNS_PGN = `[Event "runs"]
1. e4 e5 ( 1... c5 { [%ts 2:00] The Sicilian instead. } 2. Nf3 ( 2. Nc3 Nc6 3. g3 g6 4. Bg2 ) d6 3. d4 ) 2. Nf3 Nc6 ( 2... d6 { [%ts 3:00] Philidor. } ) 3. Bb5 { [%ts 1:30] The Spanish. } *`;

const runsChapter = chapterFromGame(
  (parse(RUNS_PGN, { startRule: 'games' }) as unknown as ParsedGame[])[0],
  0,
);

describe('learnDrillStore runs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    s().start(runsChapter, { runs: true });
  });
  afterEach(() => {
    s().reset();
    vi.useRealTimers();
  });

  it('enumerates the main line and each opponent sideline', () => {
    expect(s().runs.map((r) => r.path.map((n) => n.san).join(' '))).toEqual(['', 'e4 c5', 'e4 e5 Nf3 d6']);
    // Main: e4, Nf3, Bb5 = 3. Sicilian run: note + Nf3 + d4 = 3. Philidor: note = 1.
    expect(countChapterMoments(runsChapter, true)).toBe(7);
    expect(s().momentsTotal).toBe(7);
  });

  it('pauses on the final learner note before the done screen', () => {
    s().play('e2e4');
    vi.advanceTimersByTime(500);
    s().play('g1f3');
    vi.advanceTimersByTime(500);
    s().play('f1b5');
    expect(s().phase).toBe('explain');
    expect(s().message).toBe('The Spanish.');
    s().next();
    expect(s().phase).toBe('done');
    expect(s().momentsDone).toBe(3);
  });

  it('replays to a sideline, shows its note, then drills the answer', () => {
    s().play('e2e4');
    vi.advanceTimersByTime(500);
    s().play('g1f3');
    vi.advanceTimersByTime(500);
    s().play('f1b5');
    s().next();
    expect(s().nextRun()).toBe(true);
    expect(s().phase).toBe('replay');
    vi.advanceTimersByTime(2000);
    expect(s().phase).toBe('explain');
    expect(s().message).toBe('The Sicilian instead.');
    expect(s().messageTs).toBe(120);
    s().next();
    expect(s().phase).toBe('yourMove');
    expect(s().momentsDone).toBe(4);
    // The accepted alternative 2.Nc3 runs on (3.g3, 4.Bg2): two moments left
    // instead of Nf3's one (3.d4), so the total grows by one.
    s().play('b1c3');
    expect(s().momentsTotal).toBe(8);
    vi.advanceTimersByTime(500);
    s().play('g2g3');
    vi.advanceTimersByTime(500);
    s().play('f1g2');
    expect(s().phase).toBe('done');
    expect(s().momentsDone).toBe(7);
  });

  it('a sideline with no continuation is a note, then the run is done', () => {
    s().nextRun();
    s().nextRun();
    vi.advanceTimersByTime(3000);
    expect(s().message).toBe('Philidor.');
    s().next();
    expect(s().phase).toBe('done');
    expect(s().nextRun()).toBe(false);
  });

  it('without runs a chapter is just its main line', () => {
    s().start(runsChapter);
    expect(s().runs).toHaveLength(1);
    expect(s().nextRun()).toBe(false);
  });
});
