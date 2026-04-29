import { create } from 'zustand';
import { queryClient } from '../lib/queryClient';
import { supabaseService } from '../services/supabaseService';
import {
  Platform,
  ProviderProgress,
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
};

interface SyncState {
  providers: Record<ProviderKey, ProviderProgress>;
  lastTriggeredFor: string | null;
  startForProfile: (profile: UserProfile) => Promise<void>;
  reset: () => void;
}

function platformKey(p: Platform): ProviderKey {
  return p === 'lichess' ? 'lichess' : 'chesscom';
}

function setProvider(
  set: (s: Partial<SyncState> | ((s: SyncState) => Partial<SyncState>)) => void,
  key: ProviderKey,
  next: ProviderProgress,
) {
  set((s) => ({ providers: { ...s.providers, [key]: next } }));
}

async function runOne(
  platform: Platform,
  username: string,
  since: Date | null,
  set: (s: Partial<SyncState> | ((s: SyncState) => Partial<SyncState>)) => void,
): Promise<void> {
  const key = platformKey(platform);
  try {
    const result = await syncProvider(platform, username, since, (p) => setProvider(set, key, p));
    if (result.latestPlayedAt) {
      try {
        await supabaseService.updateProfileLastSynced(platform, result.latestPlayedAt);
      } catch (e) {
        console.error('Failed to persist last_synced timestamp', e);
      }
    }
    if (result.inserted.length > 0) {
      void queryClient.invalidateQueries({ queryKey: ['games'] });
    }
  } catch (e) {
    // syncProvider already emitted an error progress event
    console.error(`[sync] ${platform} failed`, e);
  }
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
    if (get().lastTriggeredFor === profile.id) return;

    const tasks: Promise<void>[] = [];
    const lichessUsername = profile.lichessUsername?.trim() ?? '';
    const chesscomUsername = profile.chesscomUsername?.trim() ?? '';

    if (lichessUsername) {
      const cur = get().providers.lichess;
      if (cur.phase !== 'fetching' && cur.phase !== 'inserting') {
        tasks.push(runOne('lichess', lichessUsername, profile.lastSyncedLichessAt, set));
      }
    }
    if (chesscomUsername) {
      const cur = get().providers.chesscom;
      if (cur.phase !== 'fetching' && cur.phase !== 'inserting') {
        tasks.push(runOne('chess.com', chesscomUsername, profile.lastSyncedChesscomAt, set));
      }
    }

    if (tasks.length === 0) return;

    set({ lastTriggeredFor: profile.id });
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
  await runOne(platform, username, since, setter);
}
