import { describe, expect, it } from 'vitest';
import { decide, eventsStateFor, firstNameOf, localTime, realEmail, validTimezone, type CandidateFacts } from './rules';

// The TypeScript port of email_candidates(): one block per rule.

const H = 3_600_000;
const D = 24 * H;
// Tuesday 2026-11-24 18:00 in New York (EST, UTC-5).
const NOW = new Date('2026-11-24T23:00:00.000Z');
const ago = (ms: number, from = NOW) => new Date(from.getTime() - ms).toISOString();

function facts(over: Partial<CandidateFacts> = {}): CandidateFacts {
  return {
    id: 'u1',
    created_at: ago(30 * D),
    email_reminders: 'daily',
    email_reports: 'weekly',
    email_hour: 18,
    email_unsub_token: 'tok',
    current_streak_days: 0,
    last_drill_local_date: '2026-11-20',
    contact_email: null,
    contact_email_verified_at: null,
    streak_freezes: 0,
    positions_goal: 10,
    games_goal: 1,
    auth_email: 'player@example.com',
    display_name: 'Ada Lovelace',
    lichess_username: null,
    chesscom_username: null,
    timezone: 'America/New_York',
    events_state: null,
    due_now: 0,
    live_total: 20,
    last_trained: ago(4 * D),
    last_any: null,
    last_reminder: null,
    last_report: null,
    last_confirm: null,
    ready_sent: 0,
    welcome_sent: 1,
    unanswered: 0,
    fresh_blunders: 0,
    ...over,
  };
}

const kindOf = (f: Partial<CandidateFacts>, now = NOW) => decide(facts(f), now).kind;

describe('localTime', () => {
  it('reads the wall clock in the player zone', () => {
    expect(localTime(NOW, 'America/New_York')).toEqual({
      tz: 'America/New_York',
      hour: 18,
      today: '2026-11-24',
      yesterday: '2026-11-23',
      isoDow: 2,
    });
  });
  it('crosses midnight and month boundaries', () => {
    // 2026-12-01 03:30 UTC = 2026-11-30 22:30 in New York (a Monday).
    expect(localTime(new Date('2026-12-01T03:30:00Z'), 'America/New_York')).toMatchObject({
      hour: 22,
      today: '2026-11-30',
      yesterday: '2026-11-29',
      isoDow: 1,
    });
    // Same instant in Kolkata (UTC+5:30) is already 09:00 on Tuesday the 1st.
    expect(localTime(new Date('2026-12-01T03:30:00Z'), 'Asia/Kolkata')).toMatchObject({
      hour: 9,
      today: '2026-12-01',
      yesterday: '2026-11-30',
      isoDow: 2,
    });
  });
  it('reports midnight as hour 0 and Sunday as 7', () => {
    expect(localTime(new Date('2026-11-29T00:00:00Z'), 'UTC')).toMatchObject({ hour: 0, isoDow: 7, yesterday: '2026-11-28' });
  });
  it('falls back to UTC for unknown or missing zones', () => {
    expect(validTimezone('Mars/Olympus')).toBe('UTC');
    expect(validTimezone(null)).toBe('UTC');
    expect(localTime(NOW, 'Not/AZone')).toMatchObject({ tz: 'UTC', hour: 23, today: '2026-11-24' });
  });
});

describe('addresses', () => {
  it('treats the Lichess placeholder as no address', () => {
    expect(realEmail('abc@lichess.invalid')).toBeNull();
    expect(realEmail('')).toBeNull();
    expect(realEmail('a@b.com')).toBe('a@b.com');
  });
  it('sends nothing to a Lichess sign-in without a contact address', () => {
    expect(decide(facts({ auth_email: 'ada@lichess.invalid', due_now: 5 }), NOW)).toMatchObject({ kind: null, to_email: null });
  });
  it('sends to a confirmed contact address over the sign-in address', () => {
    const d = decide(facts({ contact_email: 'c@example.com', contact_email_verified_at: ago(D), due_now: 5 }), NOW);
    expect(d).toMatchObject({ kind: 'daily_plan', to_email: 'c@example.com' });
  });
});

describe('confirm', () => {
  const pending = { contact_email: 'c@example.com', contact_email_verified_at: null, due_now: 5 };
  it('asks to confirm an unconfirmed contact address, at any hour, and nothing else', () => {
    expect(decide(facts(pending), NOW)).toMatchObject({ kind: 'confirm', to_email: 'c@example.com' });
    expect(kindOf({ ...pending, email_hour: 3 })).toBe('confirm');
  });
  it('re-sends at most every 23 hours', () => {
    expect(kindOf({ ...pending, last_confirm: ago(10 * H) })).toBeNull();
    expect(kindOf({ ...pending, last_confirm: ago(24 * H) })).toBe('confirm');
  });
  it('reports the pending address as the row address even when nothing is sent', () => {
    expect(decide(facts({ ...pending, last_confirm: ago(H) }), NOW).to_email).toBe('c@example.com');
  });
});

describe('welcome', () => {
  it('goes out at any hour to a new account with positions', () => {
    expect(kindOf({ created_at: ago(H), email_hour: 3, welcome_sent: 0, live_total: 4 })).toBe('welcome');
  });
  it('waits 3 hours for an account with no positions yet', () => {
    expect(kindOf({ created_at: ago(H), email_hour: 3, welcome_sent: 0, live_total: 0 })).toBeNull();
    expect(kindOf({ created_at: ago(4 * H), email_hour: 3, welcome_sent: 0, live_total: 0 })).toBe('welcome');
  });
  it('is only for accounts under 2 days old that got nothing yet', () => {
    expect(kindOf({ created_at: ago(3 * D), welcome_sent: 0, email_hour: 3 })).toBeNull();
    expect(kindOf({ created_at: ago(H), welcome_sent: 0, last_any: ago(30 * H), email_hour: 3, live_total: 4 })).toBeNull();
    expect(kindOf({ created_at: ago(H), welcome_sent: 1, email_hour: 3, live_total: 4 })).toBeNull();
  });
});

describe('hour and spacing gates', () => {
  it('sends the rest only at the local email hour', () => {
    expect(kindOf({ due_now: 5 })).toBe('daily_plan');
    expect(kindOf({ due_now: 5, email_hour: 17 })).toBeNull();
    // 18:00 in Kolkata is a different UTC instant.
    expect(kindOf({ due_now: 5, timezone: 'Asia/Kolkata' })).toBeNull();
  });
  it('never sends within 20 hours of the previous email', () => {
    expect(kindOf({ due_now: 5, last_any: ago(19 * H) })).toBeNull();
    expect(kindOf({ due_now: 5, last_any: ago(21 * H), last_reminder: ago(21 * H) })).toBe('daily_plan');
  });
});

describe('ready', () => {
  const fresh = { last_trained: null, created_at: ago(3 * D), live_total: 12, due_now: 12 };
  it('tells a player who never trained that positions are ready', () => {
    expect(kindOf(fresh)).toBe('ready');
  });
  it('only once, from 20 hours to 14 days after sign-up', () => {
    expect(kindOf({ ...fresh, ready_sent: 1 })).toBe('daily_plan');
    expect(kindOf({ ...fresh, created_at: ago(15 * D) })).toBe('daily_plan');
    expect(kindOf({ ...fresh, created_at: ago(10 * H), welcome_sent: 1 })).toBeNull();
  });
  it('needs positions', () => {
    expect(kindOf({ ...fresh, live_total: 0, due_now: 0 })).toBeNull();
  });
});

describe('weekly_report', () => {
  // Sunday 2026-11-29 18:00 in New York.
  const SUN = new Date('2026-11-29T23:00:00.000Z');
  it('goes out on the local Sunday to players who have trained', () => {
    expect(kindOf({ last_trained: ago(2 * D, SUN), due_now: 5 }, SUN)).toBe('weekly_report');
    expect(kindOf({ last_trained: null, created_at: ago(30 * D, SUN), live_total: 0 }, SUN)).toBeNull();
  });
  it('is not sent twice in 6 days, nor when reports are off', () => {
    expect(kindOf({ last_report: ago(3 * D, SUN), last_any: ago(3 * D, SUN), due_now: 5 }, SUN)).toBe('daily_plan');
    expect(kindOf({ email_reports: 'off' }, SUN)).toBeNull();
  });
  it('uses the local day, not the UTC day', () => {
    // Monday 03:00 UTC is still Sunday 22:00 in New York.
    expect(kindOf({ email_hour: 22, last_trained: ago(2 * D) }, new Date('2026-11-30T03:00:00Z'))).toBe('weekly_report');
    expect(kindOf({ email_hour: 3, timezone: 'UTC', last_trained: ago(2 * D) }, new Date('2026-11-30T03:00:00Z'))).toBeNull();
  });
});

describe('events near you', () => {
  const SUN = new Date('2026-11-29T23:00:00.000Z');
  it('rides on the weekly report for a player who saved a state', () => {
    const f = facts({ last_trained: ago(2 * D, SUN), events_state: 'MA' });
    const d = decide(f, SUN);
    expect(d.kind).toBe('weekly_report');
    expect(eventsStateFor(d.kind, f)).toBe('MA');
  });
  it('never changes which email is sent', () => {
    for (const over of [{ last_trained: ago(2 * D, SUN) }, { last_trained: ago(2 * D, SUN), email_reports: 'off', due_now: 3 }]) {
      expect(kindOf({ ...over, events_state: 'MA' }, SUN)).toBe(kindOf({ ...over, events_state: null }, SUN));
    }
  });
  it('is only in weekly reports', () => {
    for (const kind of ['welcome', 'ready', 'streak_at_risk', 'daily_plan', 'confirm', null] as const) {
      expect(eventsStateFor(kind, { events_state: 'MA' })).toBeNull();
    }
  });
  it('needs a saved, valid state', () => {
    expect(eventsStateFor('weekly_report', { events_state: null })).toBeNull();
    expect(eventsStateFor('weekly_report', { events_state: 'ma' })).toBeNull();
    expect(eventsStateFor('weekly_report', { events_state: 'ON' })).toBeNull();
    expect(eventsStateFor('weekly_report', { events_state: 'DC' })).toBe('DC');
  });
});

describe('streak_at_risk', () => {
  const atRisk = { current_streak_days: 4, last_drill_local_date: '2026-11-23', last_trained: ago(D), due_now: 5 };
  it('warns when a streak of 2+ ends yesterday', () => {
    expect(kindOf(atRisk)).toBe('streak_at_risk');
    expect(decide(facts(atRisk), NOW).streak).toBe(4);
  });
  it('not for a 1-day streak, a streak already kept today, or reminders off', () => {
    expect(kindOf({ ...atRisk, current_streak_days: 1 })).toBe('daily_plan');
    expect(kindOf({ ...atRisk, last_drill_local_date: '2026-11-24' })).toBeNull();
    expect(kindOf({ ...atRisk, email_reminders: 'off' })).toBeNull();
  });
  it('stops after 6 unanswered reminders', () => {
    expect(kindOf({ ...atRisk, unanswered: 5 })).toBe('streak_at_risk');
    expect(kindOf({ ...atRisk, unanswered: 6 })).toBeNull();
  });
  it('shows a lapsed streak as 0', () => {
    expect(decide(facts({ current_streak_days: 9, last_drill_local_date: '2026-11-20' }), NOW).streak).toBe(0);
  });
});

describe('daily_plan', () => {
  it('needs due positions and no training today', () => {
    expect(kindOf({ due_now: 3 })).toBe('daily_plan');
    expect(kindOf({ due_now: 0 })).toBeNull();
    expect(kindOf({ due_now: 3, last_drill_local_date: '2026-11-24' })).toBeNull();
    expect(kindOf({ due_now: 3, last_drill_local_date: null })).toBe('daily_plan');
  });
  it('waits 20 hours after sign-up', () => {
    expect(kindOf({ due_now: 3, created_at: ago(10 * H), last_trained: ago(H), welcome_sent: 1 })).toBeNull();
  });
  it('spaces reminders: daily 20 h, few_days 2 d 20 h', () => {
    expect(kindOf({ due_now: 3, last_reminder: ago(19 * H) })).toBeNull();
    expect(kindOf({ due_now: 3, last_reminder: ago(21 * H) })).toBe('daily_plan');
    expect(kindOf({ due_now: 3, email_reminders: 'few_days', last_reminder: ago(2 * D) })).toBeNull();
    expect(kindOf({ due_now: 3, email_reminders: 'few_days', last_reminder: ago(3 * D) })).toBe('daily_plan');
  });
  it('backs off to weekly after 3 unanswered and stops after 6', () => {
    expect(kindOf({ due_now: 3, unanswered: 3, last_reminder: ago(3 * D) })).toBeNull();
    expect(kindOf({ due_now: 3, unanswered: 3, last_reminder: ago(7 * D) })).toBe('daily_plan');
    expect(kindOf({ due_now: 3, unanswered: 6, last_reminder: ago(30 * D) })).toBeNull();
  });
  it('is off with reminders off', () => {
    expect(kindOf({ due_now: 3, email_reminders: 'off' })).toBeNull();
  });
});

describe('firstNameOf', () => {
  it('takes the first word of the display name, then the chess handles', () => {
    expect(firstNameOf({ display_name: 'Ada Lovelace', lichess_username: 'x', chesscom_username: null })).toBe('Ada');
    expect(firstNameOf({ display_name: null, lichess_username: 'adal', chesscom_username: 'c' })).toBe('adal');
    expect(firstNameOf({ display_name: ' Ada', lichess_username: null, chesscom_username: 'c' })).toBe('c');
    expect(firstNameOf({ display_name: null, lichess_username: null, chesscom_username: null })).toBeNull();
  });
});
