import { describe, expect, it } from 'vitest';
import { askAvailable, emailAskVariant, nextAsk, type AskHistory, type AskInputs, type AskKind } from './asks';

const NOW = new Date('2026-11-23T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const fresh: AskHistory = { promptedAt: null, count: 0 };

function inputs(opens: number, over: Partial<AskInputs> = {}): AskInputs {
  return {
    opens,
    now: NOW,
    eligible: { email: true, course: true, supporter: true, ...over.eligible } as Record<AskKind, boolean>,
    history: { email: fresh, course: fresh, supporter: fresh, ...over.history } as Record<AskKind, AskHistory>,
  };
}

describe('askAvailable', () => {
  it('is available before it has ever been shown', () => {
    expect(askAvailable(fresh, NOW)).toBe(true);
  });
  it('waits 14 days after the first answer, then offers once more', () => {
    expect(askAvailable({ promptedAt: daysAgo(13), count: 1 }, NOW)).toBe(false);
    expect(askAvailable({ promptedAt: daysAgo(14), count: 1 }, NOW)).toBe(true);
  });
  it('never comes back after the second answer', () => {
    expect(askAvailable({ promptedAt: daysAgo(90), count: 2 }, NOW)).toBe(false);
  });
});

describe('nextAsk', () => {
  it('asks nothing on the first open', () => {
    expect(nextAsk(inputs(1))).toBeNull();
  });
  it('asks for email from open 2', () => {
    expect(nextAsk(inputs(2))).toBe('email');
  });
  it('moves to the course ask at open 3 once email is answered', () => {
    const answered = { email: { promptedAt: daysAgo(1), count: 1 } };
    expect(nextAsk(inputs(2, { history: answered as never }))).toBeNull();
    expect(nextAsk(inputs(3, { history: answered as never }))).toBe('course');
  });
  it('skips asks that do not apply', () => {
    const eligible = { email: false, course: false, supporter: true };
    expect(nextAsk(inputs(3, { eligible: eligible as never }))).toBeNull();
    expect(nextAsk(inputs(4, { eligible: eligible as never }))).toBe('supporter');
  });
  it('shows one ask at a time, in order', () => {
    expect(nextAsk(inputs(9))).toBe('email');
  });
  it('re-offers a dismissed ask after 14 days', () => {
    const history = { email: { promptedAt: daysAgo(15), count: 1 } };
    expect(nextAsk(inputs(5, { history: history as never }))).toBe('email');
  });
});

describe('emailAskVariant', () => {
  const base = { authEmail: null, contactEmail: null, contactEmailVerified: false, optIn: false };
  it('asks a Google account with reminders off to turn them on', () => {
    expect(emailAskVariant({ ...base, authEmail: 'a@b.co' })).toBe('turn-on');
  });
  it('asks nothing once reminders are on', () => {
    expect(emailAskVariant({ ...base, authEmail: 'a@b.co', optIn: true })).toBeNull();
  });
  it('asks a Lichess sign-in for an address', () => {
    expect(emailAskVariant(base)).toBe('add-address');
    expect(emailAskVariant({ ...base, optIn: true })).toBe('add-address');
  });
  it('waits while a typed-in address is unconfirmed', () => {
    expect(emailAskVariant({ ...base, contactEmail: 'a@b.co', optIn: true })).toBeNull();
  });
  it('treats a confirmed typed-in address like any other', () => {
    expect(emailAskVariant({ ...base, contactEmail: 'a@b.co', contactEmailVerified: true })).toBe('turn-on');
  });
});
