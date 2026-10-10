import { create } from 'zustand';
import { queryClient } from '../lib/queryClient';
import { supabaseService } from '../services/supabaseService';
import {
  Platform,
  ProviderProgress,
  SyncFilters,
  syncProvider,
} from '../services/syncService';
import type { UserProfile } from '../models/userProfile';

type ProviderKey = 'lichess' | 'chesscom';

const idle: ProviderProgress = {
  phase: 'idle',
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

type SetState = (s: Partial<SyncState> | ((s: SyncState) => Partial<SyncState>)) => void;

interface SyncState {
  providers: Record<ProviderKey, ProviderProgress>;
  lastTriggeredFor: string | null;
  startForProfile: (profile: UserProfile) => Promise<void>;
  triggerNow: (profile: UserProfile) => Promise<void>;
  reset: () => void;
}

function platformKey(p: Platform): ProviderKey {
  return p === 'lichess' ? 'lichess' : 'chesscom';
}

function setProvider(set: SetState, key: ProviderKey, next: ProviderProgress) {
  set((s) => ({ providers: { ...s.providers, [key]: next } }));
}

function fingerprint(p: UserProfile): string {
  return [
    p.id,
    p.lichessUsername ?? '',
    p.chesscomUsername ?? '',
    p.preferredRatedOnly ? '1' : '0',
    [...p.preferredTimeControls].sort().join(','),
  ].join('|');
}

// The store lives in memory, so every reload used to start a fresh sync.
// Remember the last completed automatic sync per fingerprint for this tab
// session; a reload within the window skips it ("Sync now" never does).
const AUTO_SYNC_KEY = 'pc:last-auto-sync';
const AUTO_SYNC_WINDOW_MS = 5 * 60_000;

function recentlyAutoSynced(fp: string): boolean {
  try {
    const raw = sessionStorage.getItem(AUTO_SYNC_KEY);
    if (!raw) return false;
    const { fp: storedFp, at } = JSON.parse(raw) as { fp?: string; at?: number };
    return storedFp === fp && typeof at === 'number' && Date.now() - at < AUTO_SYNC_WINDOW_MS;
  } catch {
    return false;
  }
}

function markAutoSynced(fp: string): void {
  try {
    sessionStorage.setItem(AUTO_SYNC_KEY, JSON.stringify({ fp, at: Date.now() }));
  } catch {
    // storage unavailable — just sync next time
  }
}

function filtersFor(profile: UserProfile): SyncFilters {
  return {
    ratedOnly: profile.preferredRatedOnly,
    timeControls: profile.preferredTimeControls,
  };
}

// In-flight guard per provider. Every entry point (startForProfile, triggerNow,
// retryWithProfile) funnels through runOne, so a second trigger while a sync
// is running — StrictMode double effects, the SIGNED_IN + profile effects in
// AuthProvider both firing, a "Sync now" click mid-analysis — just joins the
// existing promise instead of racing the insert.
const inFlight = new Map<ProviderKey, Promise<void>>();

export function isSyncInFlight(platform: Platform): boolean {
  return inFlight.has(platformKey(platform));
}

function runOne(
  platform: Platform,
  username: string,
  since: Date | null,
  filters: SyncFilters,
  set: SetState,
): Promise<void> {
  const key = platformKey(platform);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = runOneLocked(platform, username, since, filters, set).finally(() => {
    if (inFlight.get(key) === p) inFlight.delete(key);
  });
  inFlight.set(key, p);
  return p;
}

// Cross-tab: two tabs on the same account have independent stores, so use the
// Web Locks API when available. `ifAvailable` means a second tab skips its
// sync entirely (the first tab's run covers it) rather than queueing.
async function runOneLocked(
  platform: Platform,
  username: string,
  since: Date | null,
  filters: SyncFilters,
  set: SetState,
): Promise<void> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return runOneUnlocked(platform, username, since, filters, set);
  await locks.request(`patternchess-sync:${platformKey(platform)}`, { ifAvailable: true }, async (lock) => {
    if (!lock) {
      console.info(`[sync] ${platform} already syncing in another tab; skipping`);
      return;
    }
    await runOneUnlocked(platform, username, since, filters, set);
  });
}

async function runOneUnlocked(
  platform: Platform,
  username: string,
  since: Date | null,
  filters: SyncFilters,
  set: SetState,
): Promise<void> {
  const key = platformKey(platform);
  try {
    const result = await syncProvider(platform, username, since, filters, (p) =>
      setProvider(set, key, p),
    );
    if (result.latestPlayedAt) {
      try {
        await supabaseService.updateProfileLastSynced(platform, result.latestPlayedAt);
      } catch (e) {
        console.error('Failed to persist last_synced timestamp', e);
      }
    }
    // Invalidate only when this run changed something: new games, or analysis
    // (which stamps analyzed_at even when it finds no blunders). A no-op sync —
    // every reload of a caught-up account — used to refetch every games and
    // blunders query on the dashboard a second time. Inactive queries (e.g.
    // Vault unmounted mid-sync) are still marked stale and refetch on mount.
    if (result.inserted.length > 0 || result.analyzedCount > 0) {
      void queryClient.invalidateQueries({ queryKey: ['games'] });
      void queryClient.invalidateQueries({ queryKey: ['blunders'] });
    }
  } catch (e) {
    // syncProvider already emitted an error progress event
    console.error(`[sync] ${platform} failed`, e);
  }
}

async function resolveSince(
  platform: Platform,
  username: string,
  profileTs: Date | null,
): Promise<Date | null> {
  // If the games table is empty for this user+platform, treat it as a
  // first-time/post-wipe sync and ignore any stale profile timestamp — that
  // way onboarding (or wipes that didn't clear the profile) pull a real
  // backlog instead of just the handful of games played since last sync.
  if (!profileTs) return null;
  try {
    const count = await supabaseService.getGameCount(platform, username);
    if (count === 0) return null;
  } catch (err) {
    console.warn('[sync] getGameCount failed, falling back to profile timestamp', err);
  }
  return profileTs;
}

// 'analyzing' is the long phase (minutes) and was previously not counted as
// busy, so a re-trigger during it re-fetched and re-inserted the same games.
function isBusy(p: ProviderProgress): boolean {
  return p.phase === 'fetching' || p.phase === 'inserting' || p.phase === 'analyzing';
}

async function buildTasks(
  profile: UserProfile,
  providers: Record<ProviderKey, ProviderProgress>,
  set: SetState,
  forceSince: Date | null | 'profile',
): Promise<Promise<void>[]> {
  const tasks: Promise<void>[] = [];
  const filters = filtersFor(profile);
  const lichessUsername = profile.lichessUsername?.trim() ?? '';
  const chesscomUsername = profile.chesscomUsername?.trim() ?? '';

  const runLichess =
    !!lichessUsername && !isSyncInFlight('lichess') && !isBusy(providers.lichess);
  const runChesscom =
    !!chesscomUsername && !isSyncInFlight('chess.com') && !isBusy(providers.chesscom);
  // Resolve both start points in parallel (each may be a count round trip).
  const [lichessSince, chesscomSince] = await Promise.all([
    runLichess && forceSince === 'profile'
      ? resolveSince('lichess', lichessUsername, profile.lastSyncedLichessAt)
      : forceSince === 'profile' ? null : forceSince,
    runChesscom && forceSince === 'profile'
      ? resolveSince('chess.com', chesscomUsername, profile.lastSyncedChesscomAt)
      : forceSince === 'profile' ? null : forceSince,
  ]);
  if (runLichess) tasks.push(runOne('lichess', lichessUsername, lichessSince, filters, set));
  if (runChesscom) tasks.push(runOne('chess.com', chesscomUsername, chesscomSince, filters, set));
  return tasks;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  providers: { lichess: idle, chesscom: idle },
  lastTriggeredFor: null,

  reset: () =>
    set({
      providers: { lichess: idle, chesscom: idle },
      lastTriggeredFor: null,
    }),

  startForProfile: async (profile) => {
    const fp = fingerprint(profile);
    if (get().lastTriggeredFor === fp) return;
    if (recentlyAutoSynced(fp)) {
      set({ lastTriggeredFor: fp });
      return;
    }
    // Claim the fingerprint synchronously — buildTasks awaits (resolveSince),
    // and two callers racing through that await would both pass the check.
    const prev = get().lastTriggeredFor;
    set({ lastTriggeredFor: fp });

    const tasks = await buildTasks(profile, get().providers, set, 'profile');
    if (tasks.length === 0) {
      set({ lastTriggeredFor: prev });
      return;
    }
    await Promise.allSettled(tasks);
    markAutoSynced(fp);
  },

  triggerNow: async (profile) => {
    const tasks = await buildTasks(profile, get().providers, set, 'profile');
    if (tasks.length === 0) return;
    const fp = fingerprint(profile);
    set({ lastTriggeredFor: fp });
    await Promise.allSettled(tasks);
    markAutoSynced(fp);
  },
}));

export async function retryWithProfile(profile: UserProfile, platform: Platform): Promise<void> {
  const username =
    platform === 'lichess'
      ? profile.lichessUsername?.trim() ?? ''
      : profile.chesscomUsername?.trim() ?? '';
  if (!username) return;
  const since =
    platform === 'lichess' ? profile.lastSyncedLichessAt : profile.lastSyncedChesscomAt;
  const setter = (
    s: Partial<SyncState> | ((s: SyncState) => Partial<SyncState>),
  ) => useSyncStore.setState(s as any);
  await runOne(platform, username, since, filtersFor(profile), setter);
}
