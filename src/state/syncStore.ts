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

/**
 * What the latest incremental sync(s) this tab found: new games and the
 * blunders their analysis produced. Drives the dashboard FreshBlundersCard.
 * Backlog imports (first sync / post-wipe) never set it — onboarding has its
 * own screen for those.
 */
export interface FreshFinds {
  games: number;
  blunders: number;
  gameIds: string[];
  at: number;
}

interface SyncState {
  providers: Record<ProviderKey, ProviderProgress>;
  lastTriggeredFor: string | null;
  freshFinds: FreshFinds | null;
  clearFreshFinds: () => void;
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

/** True while any provider's sync runs in this tab (it analyzes its own games). */
export function isAnySyncInFlight(): boolean {
  return inFlight.size > 0;
}

/**
 * Start (or keep alive) the opening-deviation scan without a page holding it.
 * Imported lazily: the scan pulls in the engine client and opening book code,
 * which the sync path itself never needs.
 */
function kickOpeningScan(): void {
  void import('../services/openingDeviationService')
    .then((m) => m.startOpeningDeviationScan({ detached: true }))
    .catch((e) => console.warn('[sync] could not start the openings scan', e));
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
  let scanKicked = false;
  try {
    const result = await syncProvider(platform, username, since, filters, (p) => {
      setProvider(set, key, p);
      // New games are in: their theory walk (network only) can run while
      // analysis does, so /openings fills in without waiting for the end.
      if (!scanKicked && p.phase === 'analyzing' && p.inserted > 0) {
        scanKicked = true;
        kickOpeningScan();
      }
    });
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
      // Covers the opening drill queries too (['blunders', 'kind', 'opening']).
      void queryClient.invalidateQueries({ queryKey: ['blunders'] });
      // Endgame scenarios are derived from the new endgame blunders when this
      // query runs, so the plan's endgame step appears without a reload.
      void queryClient.invalidateQueries({ queryKey: ['endgameScenarios'] });
    }
    // Every finished sync (re)starts the openings scan, whatever page is open:
    // a caught-up account may still have games the scan hasn't checked.
    kickOpeningScan();
    // Only incremental syncs celebrate: `since` is null for a backlog import.
    if (since && result.inserted.length > 0) {
      const ids = result.inserted.map((g) => g.id);
      set((s) => {
        const prev = s.freshFinds;
        return {
          freshFinds: {
            games: (prev?.games ?? 0) + result.inserted.length,
            blunders: (prev?.blunders ?? 0) + result.blundersFound,
            gameIds: [...(prev?.gameIds ?? []), ...ids],
            at: Date.now(),
          },
        };
      });
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
  freshFinds: null,

  clearFreshFinds: () => set({ freshFinds: null }),

  reset: () =>
    set({
      providers: { lichess: idle, chesscom: idle },
      lastTriggeredFor: null,
      freshFinds: null,
    }),

  startForProfile: async (profile) => {
    const fp = fingerprint(profile);
    if (get().lastTriggeredFor === fp) return;
    if (recentlyAutoSynced(fp)) {
      set({ lastTriggeredFor: fp });
      // No sync this load, but a reload may have cut the last openings pass short.
      kickOpeningScan();
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
