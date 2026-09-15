import { describe, expect, it } from 'vitest';
import {
  winPercent,
  winningChancesLost,
  classify,
  classifySwing,
  isTrainable,
  cpLoss,
  cpForColor,
  roundedChancesLost,
  inaccuracyThresholdPercent,
  mistakeThresholdPercent,
  blunderThresholdPercent,
} from './winningChances';

describe('winPercent', () => {
  it('maps an even position to 50%', () => {
    expect(winPercent(0)).toBeCloseTo(50, 6);
  });

  it('is symmetric about zero', () => {
    expect(winPercent(300) + winPercent(-300)).toBeCloseTo(100, 6);
  });

  it('is monotonic increasing in centipawns', () => {
    expect(winPercent(100)).toBeGreaterThan(winPercent(0));
    expect(winPercent(1000)).toBeGreaterThan(winPercent(100));
  });

  it('stays within 0..100 at extremes', () => {
    expect(winPercent(100000)).toBeLessThanOrEqual(100);
    expect(winPercent(100000)).toBeGreaterThan(99);
    expect(winPercent(-100000)).toBeGreaterThanOrEqual(0);
    expect(winPercent(-100000)).toBeLessThan(1);
  });
});

describe('winningChancesLost', () => {
  it('is ~0 when the eval is unchanged (evalAfter is opponent-perspective)', () => {
    // A move that keeps the position level: before = 0, after = 0 (from the
    // opponent's side-to-move perspective) → negated to 0 for the mover.
    expect(winningChancesLost(0, 0)).toBeCloseTo(0, 6);
  });

  it('is positive when the move worsens the position', () => {
    // Was winning (+300); after the move the opponent is now +300 → the mover
    // handed over a large chunk of winning chances.
    expect(winningChancesLost(300, 300)).toBeGreaterThan(0);
  });

  it('is negative when the move improves the position (opponent worse off)', () => {
    expect(winningChancesLost(0, -300)).toBeLessThan(0);
  });
});

describe('classify thresholds', () => {
  it('orders the thresholds inaccuracy < mistake < blunder', () => {
    expect(inaccuracyThresholdPercent).toBeLessThan(mistakeThresholdPercent);
    expect(mistakeThresholdPercent).toBeLessThan(blunderThresholdPercent);
  });

  it('classifies below the inaccuracy threshold as good', () => {
    expect(classify(inaccuracyThresholdPercent - 0.01)).toBe('good');
    expect(classify(0)).toBe('good');
  });

  it('classifies exactly at each boundary as the higher tier (>=)', () => {
    expect(classify(inaccuracyThresholdPercent)).toBe('inaccuracy');
    expect(classify(mistakeThresholdPercent)).toBe('mistake');
    expect(classify(blunderThresholdPercent)).toBe('blunder');
  });

  it('classifies just below a boundary as the lower tier', () => {
    expect(classify(mistakeThresholdPercent - 0.01)).toBe('inaccuracy');
    expect(classify(blunderThresholdPercent - 0.01)).toBe('mistake');
  });
});

describe('isTrainable', () => {
  it('is trainable at and above the mistake threshold (15%)', () => {
    expect(isTrainable(mistakeThresholdPercent)).toBe(true);
    expect(isTrainable(mistakeThresholdPercent + 5)).toBe(true);
  });

  it('is not trainable below the mistake threshold', () => {
    expect(isTrainable(mistakeThresholdPercent - 0.01)).toBe(false);
    expect(isTrainable(inaccuracyThresholdPercent)).toBe(false);
  });
});

describe('classifySwing', () => {
  it('returns both the raw chances lost and its classification, consistently', () => {
    const before = 300;
    const after = 300;
    const result = classifySwing(before, after);
    expect(result.chancesLost).toBeCloseTo(winningChancesLost(before, after), 6);
    expect(result.classification).toBe(classify(result.chancesLost));
  });
});

describe('roundedChancesLost', () => {
  it('is the rounded winning-chances-lost value', () => {
    const before = 250;
    const after = 250;
    expect(roundedChancesLost(before, after)).toBe(Math.round(winningChancesLost(before, after)));
    expect(Number.isInteger(roundedChancesLost(before, after))).toBe(true);
  });
});

describe('cpLoss', () => {
  it('is zero when the move keeps the eval level', () => {
    expect(cpLoss(0, 0)).toBe(0);
  });

  it('is positive when the move gives away centipawns (evalAfter negated back)', () => {
    // before +200, opponent now +200 → mover lost 400cp.
    expect(cpLoss(200, 200)).toBe(400);
  });
});

describe('cpForColor', () => {
  it('returns the score unchanged when the side to move is the target color', () => {
    expect(cpForColor(150, 'white', 'white')).toBe(150);
    expect(cpForColor(150, 'black', 'black')).toBe(150);
  });

  it('negates the score when viewing from the other color', () => {
    expect(cpForColor(150, 'white', 'black')).toBe(-150);
    expect(cpForColor(150, 'black', 'white')).toBe(-150);
  });
});
