import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from '@mliebelt/pgn-parser';
import { chapterFromGame, type ParsedGame } from '../learn/pgnToTree';
import { countMoments, useLearnDrillStore } from './learnDrillStore';

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
