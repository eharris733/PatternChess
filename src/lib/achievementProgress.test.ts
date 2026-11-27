import { describe, expect, it } from 'vitest';
import { achievementProgressLabel } from './achievements';
import { playTargets } from '../hooks/useDailyPlan';
import { interpolate } from '../i18n/i18n';
import type { Translator } from '../i18n/useT';
import pt from '../i18n/pt.json';

describe('achievementProgressLabel', () => {
  it('gives time achievements their unit', () => {
    expect(achievementProgressLabel({ metric: 'minutesTrained', value: 581, threshold: 600 })).toBe('9h 41m/10h');
    expect(achievementProgressLabel({ metric: 'minutesTrained', value: 45, threshold: 600 })).toBe('45m/10h');
    expect(achievementProgressLabel({ metric: 'minutesTrained', value: 900, threshold: 600 })).toBe('10h/10h');
  });

  it('uses the player\'s language for the units', () => {
    const catalog = pt as Record<string, string>;
    const t = ((key: string, vars?: Record<string, string | number>) => interpolate(catalog[key], vars)) as Translator;
    expect(achievementProgressLabel({ metric: 'minutesTrained', value: 581, threshold: 600 }, t)).toBe('9h41min/10h');
    expect(achievementProgressLabel({ metric: 'minutesTrained', value: 45, threshold: 600 }, t)).toBe('45min/10h');
  });

  it('keeps plain counts for everything else', () => {
    expect(achievementProgressLabel({ metric: 'reviewed', value: 1250, threshold: 2000 })).toBe(
      `${(1250).toLocaleString()}/${(2000).toLocaleString()}`,
    );
  });
});

describe('playTargets', () => {
  it('offers every linked site, Lichess first', () => {
    expect(playTargets('alice', 'alice_cc').map((p) => p.platform)).toEqual(['lichess', 'chesscom']);
    expect(playTargets(null, 'alice_cc').map((p) => p.platform)).toEqual(['chesscom']);
    expect(playTargets('alice', null).map((p) => p.platform)).toEqual(['lichess']);
    expect(playTargets(null, null)).toEqual([]);
  });
});
