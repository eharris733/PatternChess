import { describe, expect, it } from 'vitest';
import type { ProviderProgress } from '../services/syncService';
import { fetchCount, fetchingHeadline, fetchingLine, monthDetail, summarizeFetch } from './syncProgress';

const base: ProviderProgress = {
  phase: 'fetching',
  fetched: 0,
  inserted: 0,
  total: null,
  error: null,
  analyzeGameIndex: 0,
  analyzeGamesTotal: 0,
  analyzePositionIndex: 0,
  analyzePositionsTotal: 0,
  blundersFound: 0,
};

describe('syncProgress', () => {
  it('words chess.com months by what bounds the fetch', () => {
    expect(monthDetail({ monthsDone: 2, monthsTotal: 3 })).toBe('month 2/3');
    // Before the first archive lands, an incremental sync still says month 1.
    expect(monthDetail({ monthsDone: 0, monthsTotal: 2 })).toBe('month 1/2');
    expect(monthDetail({ monthsDone: 3, monthsTotal: null })).toBe('3 months back');
    expect(monthDetail({ monthsDone: 1, monthsTotal: null })).toBe('1 month back');
    expect(monthDetail({ monthsDone: 0, monthsTotal: null })).toBeNull();
    expect(monthDetail({})).toBeNull();
  });

  it('sums only the providers still fetching', () => {
    const chesscom = { ...base, fetched: 57, total: 200, monthsDone: 3, monthsTotal: null };
    const lichess = { ...base, fetched: 40, total: 200 };
    expect(summarizeFetch([chesscom, lichess])).toEqual({ fetched: 97, target: 400, months: '3 months back' });
    expect(summarizeFetch([chesscom, { ...lichess, phase: 'analyzing' }])).toEqual({
      fetched: 57,
      target: 200,
      months: '3 months back',
    });
    expect(summarizeFetch([{ ...base, phase: 'done' }])).toBeNull();
    // An open-ended (incremental) provider makes the whole target unknown.
    expect(summarizeFetch([chesscom, { ...lichess, total: null }])?.target).toBeNull();
  });

  it('formats the line', () => {
    expect(fetchCount({ fetched: 57, target: 200 })).toBe('57 of 200');
    expect(fetchCount({ fetched: 230, target: 200 })).toBe('200 of 200');
    expect(fetchCount({ fetched: 12, target: null })).toBe('12');
    expect(fetchingLine({ fetched: 57, target: 200, months: '3 months back' })).toBe(
      'Fetching games… 57 of 200 (3 months back)',
    );
    expect(fetchingLine({ fetched: 4, target: null, months: 'month 1/2' })).toBe('Fetching games… 4 (month 1/2)');
    // Nothing counted yet: no "0".
    expect(fetchingLine({ fetched: 0, target: 200, months: null })).toBe('Fetching games…');
    expect(fetchingHeadline({ fetched: 0, target: null, months: null })).toBe('Fetching…');
    expect(fetchingHeadline({ fetched: 57, target: 200, months: '3 months back' })).toBe('Fetching 57 of 200');
    expect(fetchingHeadline({ fetched: 0, target: null, months: 'month 1/2' })).toBe('Fetching 0');
  });
});
