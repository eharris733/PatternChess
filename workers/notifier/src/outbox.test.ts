import { describe, expect, it } from 'vitest';
import { MOTIF_LABEL as APP_MOTIF_LABEL } from '../../../src/chess/motifs';
import { MOTIF_LABEL } from './motifLabels';
import { buildLinks, lastSevenDays, mayReceive, parseRecipients, toEmailData, unsubscribeHeaders, type OutboxData } from './outbox';
import { renderEmail } from './templates';

const DATA: OutboxData = {
  firstName: 'Elliot',
  streak: 3,
  streakFreezes: 1,
  lastDrillLocalDate: '2026-11-21',
  localToday: '2026-11-22',
  dueNow: 12,
  liveTotal: 40,
  positionsGoal: 10,
  gamesGoal: 1,
  freshBlunders: 2,
  communityElo: 6064,
  report: {
    solved: 52,
    attempted: 61,
    minutes: 74,
    activeDays: 6,
    newlyMastered: 4,
    gamesPlayed: 9,
    eloChange: 18,
    leaderboardRank: 7,
    topMotif: 'missedFork',
  },
};

describe('motif labels', () => {
  it('match the app (src/chess/motifs.ts)', () => {
    expect(MOTIF_LABEL).toEqual(APP_MOTIF_LABEL);
  });
});

describe('lastSevenDays', () => {
  it('marks the streak run ending at the last training day', () => {
    // Streak of 3 ending yesterday: days -3, -2, -1 on, today off.
    expect(lastSevenDays('2026-11-21', 3, '2026-11-22')).toEqual([false, false, false, true, true, true, false]);
  });
  it('includes today when trained today', () => {
    expect(lastSevenDays('2026-11-22', 2, '2026-11-22')).toEqual([false, false, false, false, false, true, true]);
  });
  it('is all off with no streak', () => {
    expect(lastSevenDays(null, 0, '2026-11-22')).toEqual(Array(7).fill(false));
    expect(lastSevenDays('2026-11-10', 0, '2026-11-22')).toEqual(Array(7).fill(false));
  });
  it('caps a long streak at the 7-day window', () => {
    expect(lastSevenDays('2026-11-22', 40, '2026-11-22')).toEqual(Array(7).fill(true));
  });
  it('crosses a month boundary', () => {
    expect(lastSevenDays('2026-12-01', 2, '2026-12-01')).toEqual([false, false, false, false, false, true, true]);
  });
});

describe('toEmailData', () => {
  it('maps the motif id to its label', () => {
    expect(toEmailData(DATA).report?.topMotif).toBe('Missed fork');
  });
  it('drops an unknown motif id', () => {
    expect(toEmailData({ ...DATA, report: { ...DATA.report!, topMotif: 'nope' } }).report?.topMotif).toBeNull();
  });
});

describe('links and headers', () => {
  const links = buildLinks({ app: 'https://patternchess.com', email: 'https://email.patternchess.com' }, 'daily_plan', 'tok');
  it('points settings and unsubscribe at the Worker', () => {
    expect(links.settings).toBe('https://email.patternchess.com/settings?t=tok');
    expect(links.unsubscribe).toBe('https://email.patternchess.com/unsubscribe?t=tok');
    expect(links.train).toContain('utm_campaign=daily_plan');
  });
  it('sends RFC 8058 one-click headers', () => {
    expect(unsubscribeHeaders(links)).toEqual({
      'List-Unsubscribe': '<https://email.patternchess.com/unsubscribe?t=tok>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });
});

describe('test-mode gate', () => {
  const allow = parseRecipients(' Elliot@Example.com, b@example.com ');
  it('only lets test recipients through outside live mode', () => {
    expect(mayReceive('test', allow, 'elliot@example.com')).toBe(true);
    expect(mayReceive('test', allow, 'someone@else.com')).toBe(false);
    expect(mayReceive(undefined, allow, 'someone@else.com')).toBe(false);
    expect(mayReceive('live', allow, 'someone@else.com')).toBe(true);
  });
});

describe('rendered emails', () => {
  const links = buildLinks({ app: 'https://patternchess.com', email: 'https://email.patternchess.com' }, 'weekly_report', 'tok');
  it('carry the postal address and unsubscribe link in both parts', () => {
    for (const kind of ['welcome', 'ready', 'streak_at_risk', 'daily_plan', 'weekly_report'] as const) {
      const e = renderEmail(kind, toEmailData(DATA), links);
      for (const part of [e.html, e.text]) {
        expect(part).toContain('2592 Mass Ave, Cambridge, MA 02140');
        expect(part).toContain('https://email.patternchess.com/unsubscribe?t=tok');
      }
    }
  });
  it('shows the motif label in the weekly report', () => {
    expect(renderEmail('weekly_report', toEmailData(DATA), links).html).toContain('Missed fork');
  });
});
