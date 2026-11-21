import { del, get, set } from 'idb-keyval';
import type { Query } from '@tanstack/react-query';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';

// Keeps the dashboard/vault query cache in IndexedDB between visits, so a
// return visit paints the last numbers immediately and refreshes them in the
// background (restored data is stale, so mounted queries refetch as usual).
//
// IndexedDB stores by structured clone, so the Date fields on GameRecord /
// Blunder survive a round trip (a JSON persister would turn them into strings).

const IDB_KEY = 'pc:query-cache';
const WRITE_THROTTLE_MS = 1000;
/** Persisted data older than this is dropped on restore. */
export const PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/**
 * Busts the cache on every deploy: in a build this module lives in the
 * content-hashed entry chunk, whose name changes whenever the app does, so a
 * cache written by an older build (possibly with older data shapes) is never
 * restored. In dev the URL is stable, which is fine.
 */
export const PERSIST_BUSTER = import.meta.env.DEV ? 'dev' : new URL(import.meta.url).pathname;

// Query-key roots worth restoring: the read-only stats and lists behind the
// dashboard, vault and endgames. Anything that drives a drill (the due queue,
// training filters) is left out so a session never starts from a stale queue.
const PERSISTED_ROOTS = new Set([
  'games',
  'blunders',
  'blunderCounts',
  'insights',
  'endgameScenarios',
  'training',
  'benchmarks',
  'otbEvents',
]);
const EXCLUDED: ReadonlyArray<readonly string[]> = [
  ['blunders', 'due'],
  ['blunders', 'forGames'],
  ['training', 'filterGames'],
];

export function shouldPersistQuery(query: Query): boolean {
  if (query.state.status !== 'success') return false;
  const key = query.queryKey;
  if (typeof key[0] !== 'string' || !PERSISTED_ROOTS.has(key[0])) return false;
  return !EXCLUDED.some((prefix) => prefix.every((part, i) => key[i] === part));
}

/** IndexedDB persister with throttled writes; storage failures are never fatal. */
export function createIdbPersister(): Persister {
  let pending: PersistedClient | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    timer = null;
    const client = pending;
    pending = null;
    if (!client) return;
    try {
      await set(IDB_KEY, client);
    } catch (err) {
      // Private mode, quota, or a value structured clone can't copy.
      console.warn('[queryPersist] write failed', err);
    }
  };

  return {
    persistClient: (client) => {
      pending = client;
      if (!timer) timer = setTimeout(() => void flush(), WRITE_THROTTLE_MS);
    },
    restoreClient: async () => {
      try {
        return await get<PersistedClient>(IDB_KEY);
      } catch {
        return undefined;
      }
    },
    removeClient: async () => {
      pending = null;
      if (timer) clearTimeout(timer);
      timer = null;
      try {
        await del(IDB_KEY);
      } catch {
        // Nothing to clear.
      }
    },
  };
}

export const queryPersister = createIdbPersister();

/** Drop the persisted cache (sign-out: never leave one user's data for the next). */
export async function clearPersistedQueries(): Promise<void> {
  await queryPersister.removeClient();
}
