import { describe, expect, it, vi } from 'vitest';
import { US_STATES } from '../../../src/lib/usStates';
import {
  addDays,
  eventsApiUrl,
  EVENTS_MAX,
  formatDay,
  formatTime,
  nearbyEvents,
  stateEventsLoader,
  type EventApiRow,
} from './events';
import { US_STATE_NAME } from './usStates';

const TODAY = '2026-11-29'; // a Sunday

function row(over: Partial<EventApiRow> & { id: number }): EventApiRow {
  return {
    title: `Event ${over.id}`,
    club_name: 'Boylston Chess Foundation',
    club_city: 'Boston',
    start_date: '2026-12-05',
    end_date: '2026-12-05',
    start_time: null,
    ...over,
  };
}

describe('state names', () => {
  it('match the app (src/lib/usStates.ts)', () => {
    expect(US_STATE_NAME).toEqual(Object.fromEntries(US_STATES.map((s) => [s.code, s.name])));
  });
});

describe('formatting', () => {
  it('formats days, times and offsets', () => {
    expect(formatDay('2026-11-29')).toBe('Sun, Nov 29');
    expect(formatDay('2027-01-01')).toBe('Fri, Jan 1');
    expect(formatTime('19:30')).toBe('7:30 PM');
    expect(formatTime('10:00')).toBe('10:00 AM');
    expect(formatTime('00:15')).toBe('12:15 AM');
    expect(formatTime('12:00')).toBe('12:00 PM');
    expect(formatTime(null)).toBeNull();
    expect(formatTime('TBD')).toBeNull();
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('asks the API for the state through the end of the two-week window', () => {
    expect(eventsApiUrl('https://events.patternchess.com', 'MA', TODAY)).toBe(
      'https://events.patternchess.com/api/events?state=MA&to=2026-12-12',
    );
  });
});

describe('nearbyEvents', () => {
  it('lists each tournament once at its next meeting day, nearest first, with club and link', () => {
    const items = nearbyEvents(
      [
        row({ id: 2, title: 'Late', start_date: '2026-12-08', end_date: '2026-12-08', start_time: '19:00' }),
        row({
          id: 1,
          title: 'Tuesday Swiss',
          start_date: '2026-11-17',
          end_date: '2026-12-08',
          start_time: '18:30',
          occurrences: [
            { date: '2026-11-17', end_date: '2026-11-17', round: 1, total_rounds: 4 },
            { date: '2026-11-24', end_date: '2026-11-24', round: 2, total_rounds: 4 },
            { date: '2026-12-01', end_date: '2026-12-01', round: 3, total_rounds: 4 },
            { date: '2026-12-08', end_date: '2026-12-08', round: 4, total_rounds: 4 },
          ],
        }),
        row({ id: 3, title: 'Weekend Open', start_date: '2026-12-05', end_date: '2026-12-06', club_city: null, event_city: 'Worcester' }),
      ],
      TODAY,
    );
    expect(items).toEqual([
      {
        title: 'Tuesday Swiss',
        when: 'Rd 3 of 4 · Tue, Dec 1 · 6:30 PM',
        where: 'Boylston Chess Foundation · Boston',
        url: 'https://events.patternchess.com/events/1',
      },
      {
        title: 'Weekend Open',
        when: 'Sat, Dec 5 to Sun, Dec 6',
        where: 'Boylston Chess Foundation · Worcester',
        url: 'https://events.patternchess.com/events/3',
      },
      { title: 'Late', when: 'Tue, Dec 8 · 7:00 PM', where: 'Boylston Chess Foundation · Boston', url: 'https://events.patternchess.com/events/2' },
    ]);
  });

  it('keeps today, drops past, cancelled and beyond-the-window rows', () => {
    const items = nearbyEvents(
      [
        row({ id: 1, title: 'Today', start_date: TODAY, end_date: TODAY }),
        row({ id: 2, title: 'Yesterday', start_date: '2026-11-28', end_date: '2026-11-28' }),
        row({ id: 3, title: 'Cancelled', status: 'cancelled' }),
        row({ id: 4, title: 'Day 13', start_date: '2026-12-12', end_date: '2026-12-12' }),
        row({ id: 5, title: 'Day 14', start_date: '2026-12-13', end_date: '2026-12-13' }),
      ],
      TODAY,
    );
    expect(items.map((i) => i.title)).toEqual(['Today', 'Day 13']);
  });

  it('drops season-long blocks and sorts a block under way as today', () => {
    const items = nearbyEvents(
      [
        row({ id: 1, title: 'Tomorrow', start_date: '2026-11-30', end_date: '2026-11-30', start_time: '09:00' }),
        row({ id: 2, title: 'All year', start_date: '2026-01-11', end_date: '2026-12-06' }),
        row({ id: 3, title: 'Weekend under way', start_date: '2026-11-28', end_date: '2026-11-30', start_time: '10:00' }),
      ],
      TODAY,
    );
    expect(items.map((i) => i.title)).toEqual(['Weekend under way', 'Tomorrow']);
  });

  it('orders same-day events by start time and caps the list', () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      row({ id: i + 1, title: `E${i + 1}`, start_time: i % 2 ? null : `1${i}:00` }),
    );
    const items = nearbyEvents(rows, TODAY);
    expect(items).toHaveLength(EVENTS_MAX);
    expect(items.map((i) => i.title).slice(0, 4)).toEqual(['E1', 'E3', 'E5', 'E7']);
  });
});

describe('stateEventsLoader', () => {
  const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });

  it('fetches each state once per run and returns the listing', async () => {
    const fetchImpl = vi.fn(async () => ok([row({ id: 9, title: 'Rapid' })]));
    const load = stateEventsLoader(fetchImpl as unknown as typeof fetch, 'https://ev.test');
    const [a, b] = await Promise.all([load('MA', TODAY), load('MA', TODAY)]);
    expect(a).toEqual(b);
    expect(a?.[0]).toMatchObject({ title: 'Rapid', url: 'https://ev.test/events/9' });
    await load('NH', TODAY);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe('https://ev.test/api/events?state=MA&to=2026-12-12');
  });

  it('turns failures into null without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cases: Array<() => Promise<Response>> = [
      async () => new Response('{}', { status: 500 }),
      async () => new Response('not json', { status: 200 }),
      async () => ok('nope'),
      async () => {
        throw new TypeError('network down');
      },
    ];
    for (const impl of cases) {
      const load = stateEventsLoader(vi.fn(impl) as unknown as typeof fetch, 'https://ev.test');
      await expect(load('MA', TODAY)).resolves.toBeNull();
    }
    warn.mockRestore();
  });

  it('gives up after the timeout', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hang = (_: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    const load = stateEventsLoader(hang as unknown as typeof fetch, 'https://ev.test', 20);
    await expect(load('MA', TODAY)).resolves.toBeNull();
    warn.mockRestore();
  });
});
