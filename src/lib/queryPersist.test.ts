import { describe, expect, it, vi } from 'vitest';
import type { Query } from '@tanstack/react-query';

vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }));

const { shouldPersistQuery } = await import('./queryPersist');

const q = (queryKey: unknown[], status = 'success') =>
  ({ queryKey, state: { status } }) as unknown as Query;

describe('shouldPersistQuery', () => {
  it('persists read-only stats and lists', () => {
    expect(shouldPersistQuery(q(['games', 'list', 'u1']))).toBe(true);
    expect(shouldPersistQuery(q(['blunders', 'stats', 'u1']))).toBe(true);
  });

  it('never persists the onboarding game count (a restored 0 re-shows onboarding)', () => {
    expect(shouldPersistQuery(q(['games', 'totalCount', 'u1']))).toBe(false);
  });

  it('never persists the due queue, unknown roots or unfinished queries', () => {
    expect(shouldPersistQuery(q(['blunders', 'due', 'u1']))).toBe(false);
    expect(shouldPersistQuery(q(['profile', 'u1']))).toBe(false);
    expect(shouldPersistQuery(q(['games', 'list', 'u1'], 'pending'))).toBe(false);
  });
});
