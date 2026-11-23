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
  it('lists the daily plan in the app order: train first, play last', () => {
    const e = renderEmail('daily_plan', toEmailData(DATA), links);
    expect(e.subject).toBe("Today's plan: train 10 positions, then play 1 game");
    expect(e.text.indexOf('Positions to train')).toBeLessThan(e.text.indexOf('Games to play'));
    const noGames = renderEmail('daily_plan', toEmailData({ ...DATA, gamesGoal: 0 }), links);
    expect(noGames.subject).toBe("Today's plan: train 10 positions");
    expect(noGames.html).not.toContain('Games to play');
  });
  it('shows the motif label in the weekly report', () => {
    expect(renderEmail('weekly_report', toEmailData(DATA), links).html).toContain('Missed fork');
  });
});

describe('events near you', () => {
  const links = buildLinks({ app: 'https://patternchess.com', email: 'https://email.patternchess.com' }, 'weekly_report', 'tok');
  const EVENTS = [
    { title: 'Boylston Saturday Open', when: 'Sat, Dec 5 · 10:00 AM', where: 'Boylston Chess Foundation · Boston', url: 'https://events.patternchess.com/events/7' },
    { title: 'MCC <Monthly> Swiss', when: 'Rd 2 of 4 · Tue, Dec 1 · 7:30 PM', where: 'MetroWest Chess Club · Framingham', url: 'https://events.patternchess.com/events/41' },
  ];
  const WITH = { ...DATA, eventsRegion: 'US-MA', events: EVENTS };

  it('maps a saved state and its listing into the template data', () => {
    expect(toEmailData(WITH).nearbyEvents).toEqual({
      stateName: 'Massachusetts',
      items: EVENTS,
      seeAllUrl: 'https://events.patternchess.com/ma',
    });
  });

  it('leaves the section out with no state, an empty listing or a failed lookup', () => {
    expect(toEmailData(DATA).nearbyEvents).toBeUndefined();
    expect(toEmailData({ ...WITH, events: [] }).nearbyEvents).toBeUndefined();
    expect(toEmailData({ ...WITH, events: null }).nearbyEvents).toBeUndefined();
    expect(toEmailData({ ...WITH, eventsRegion: 'XX' }).nearbyEvents).toBeUndefined();
  });

  it('names a country region and links its page', () => {
    expect(toEmailData({ ...WITH, eventsRegion: 'GB-ENG' }).nearbyEvents).toMatchObject({
      stateName: 'England',
      seeAllUrl: 'https://events.patternchess.com/england',
    });
  });

  it('renders the listings in both parts of the weekly report, escaped', () => {
    const e = renderEmail('weekly_report', toEmailData(WITH), links);
    expect(e.html).toContain('Events near you');
    expect(e.html).toContain('Over-the-board tournaments in Massachusetts in the next two weeks.');
    expect(e.html).toContain('href="https://events.patternchess.com/events/7"');
    expect(e.html).toContain('MCC &lt;Monthly&gt; Swiss');
    expect(e.html).not.toContain('<Monthly>');
    expect(e.html).toContain('All Massachusetts tournaments');
    expect(e.text).toContain('EVENTS NEAR YOU');
    expect(e.text).toContain('Boylston Saturday Open\nSat, Dec 5 · 10:00 AM\nBoylston Chess Foundation · Boston\nhttps://events.patternchess.com/events/7');
    expect(e.text).toContain('All Massachusetts tournaments: https://events.patternchess.com/ma');
    // The footer still closes the email after the section.
    expect(e.html.indexOf('Events near you')).toBeLessThan(e.html.indexOf('2592 Mass Ave'));
  });

  it('is listings only: no supporter or sign-up pitch', () => {
    const e = renderEmail('weekly_report', toEmailData(WITH), links);
    for (const part of [e.html, e.text]) {
      expect(part).not.toMatch(/supporter|upgrade|subscribe to|sign up/i);
    }
  });

  it('never appears in the other emails, nor in a report without a listing', () => {
    for (const kind of ['welcome', 'ready', 'streak_at_risk', 'daily_plan', 'confirm'] as const) {
      expect(renderEmail(kind, toEmailData(WITH), links).html).not.toContain('Events near you');
    }
    expect(renderEmail('weekly_report', toEmailData(DATA), links).html).not.toContain('Events near you');
  });
});
