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

function filtersFor(profile: UserProfile): SyncFilters {
  return {
    ratedOnly: profile.preferredRatedOnly,
    timeControls: profile.preferredTimeControls,
  };
}

async function runOne(
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
    // Always invalidate after a successful sync — analyzed_at on existing games
    // changes even when no new games were inserted and no blunders were found.
    // refetchType: 'all' covers cases where Vault has unmounted mid-sync.
    void queryClient.invalidateQueries({ queryKey: ['games'], refetchType: 'all' });
    void queryClient.invalidateQueries({ queryKey: ['blunders'], refetchType: 'all' });
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

  if (lichessUsername) {
    const cur = providers.lichess;
    if (cur.phase !== 'fetching' && cur.phase !== 'inserting') {
      const since =
        forceSince === 'profile'
          ? await resolveSince('lichess', lichessUsername, profile.lastSyncedLichessAt)
          : forceSince;
      tasks.push(runOne('lichess', lichessUsername, since, filters, set));
    }
  }
  if (chesscomUsername) {
    const cur = providers.chesscom;
    if (cur.phase !== 'fetching' && cur.phase !== 'inserting') {
      const since =
        forceSince === 'profile'
          ? await resolveSince('chess.com', chesscomUsername, profile.lastSyncedChesscomAt)
          : forceSince;
      tasks.push(runOne('chess.com', chesscomUsername, since, filters, set));
    }
  }
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

    const tasks = await buildTasks(profile, get().providers, set, 'profile');
    if (tasks.length === 0) return;

    set({ lastTriggeredFor: fp });
    await Promise.allSettled(tasks);
  },

  triggerNow: async (profile) => {
    const tasks = await buildTasks(profile, get().providers, set, 'profile');
    if (tasks.length === 0) return;
    set({ lastTriggeredFor: fingerprint(profile) });
    await Promise.allSettled(tasks);
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
