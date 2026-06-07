import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { authService } from '../services/authService';
import type { TimeControlCategory } from '../services/chessApiService';
import { supabaseService } from '../services/supabaseService';
import {
  BackfillProgress,
  runGameMetadataBackfill,
} from '../services/gameMetadataBackfill';
import { RankBadge } from '../components/insights/RankBadge';
import { GameTypePreferences } from '../components/GameTypePreferences';
import { ThemePicker } from '../components/ThemePicker';
import { useRecentTrainingSessions } from '../hooks/useTrainingActivity';
import { useThemeStore, type BoardTheme } from '../state/themeStore';

export function ProfileRoute() {
  const { profile, refreshProfile, user } = useAuth();
  const queryClient = useQueryClient();
  const activeTheme = useThemeStore((s) => s.theme);
  const setStoreTheme = useThemeStore((s) => s.setTheme);
  const [lichess, setLichess] = useState('');
  const [chesscom, setChesscom] = useState('');
  const [ratedOnly, setRatedOnly] = useState(false);
  const [timeControls, setTimeControls] = useState<TimeControlCategory[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<BackfillProgress | null>(null);

  const onPickTheme = (next: BoardTheme) => {
    setStoreTheme(next);
    if (profile && profile.boardTheme !== next) {
      void authService
        .updateProfile({ ...profile, boardTheme: next })
        .then(() => refreshProfile())
        .catch((err) => console.warn('[profile] persist boardTheme failed', err));
    }
  };

  const unparsedQuery = useQuery({
    queryKey: ['games', 'unparsedCount', user?.id],
    queryFn: () => supabaseService.countUnparsedGames(),
    enabled: !!user,
  });
  const unparsedCount = unparsedQuery.data ?? 0;

  const recentSessions = useRecentTrainingSessions(10);

  const onBackfill = async () => {
    setBackfillRunning(true);
    setBackfillProgress({ processed: 0, total: unparsedCount, failed: 0 });
    try {
      const final = await runGameMetadataBackfill({
        onProgress: (p) => setBackfillProgress(p),
      });
      setBackfillProgress(final);
      await queryClient.invalidateQueries({ queryKey: ['games'] });
    } finally {
      setBackfillRunning(false);
    }
  };

  const timeControlsKey = profile
    ? [...profile.preferredTimeControls].sort().join(',')
    : '';
  useEffect(() => {
    setLichess(profile?.lichessUsername ?? '');
    setChesscom(profile?.chesscomUsername ?? '');
    setRatedOnly(profile?.preferredRatedOnly ?? false);
    setTimeControls(profile?.preferredTimeControls ?? []);
  }, [
    profile?.id,
    profile?.lichessUsername,
    profile?.chesscomUsername,
    profile?.preferredRatedOnly,
    timeControlsKey,
  ]);

  const toggleTimeControl = (value: TimeControlCategory) => {
    setTimeControls((cur) =>
      cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value],
    );
  };

  const onSave = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      await authService.updateProfile({
        ...profile,
        lichessUsername: lichess.trim() || null,
        chesscomUsername: chesscom.trim() || null,
        preferredRatedOnly: ratedOnly,
        preferredTimeControls: timeControls,
      });
      // Claim any anon games matching either username
      if (lichess.trim()) await authService.claimAnonymousData(lichess.trim());
      if (chesscom.trim()) await authService.claimAnonymousData(chesscom.trim());
      await refreshProfile();
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  const onSignOut = async () => {
    // Clear the session, then hard-replace to the public landing page ('/'). A
    // SPA navigate would race the not-yet-cleared session and bounce through
    // /dashboard → /login; the timeout guards a hung sign-out request from
    // trapping the user on a protected screen.
    await Promise.race([
      authService.signOut().catch((e) => console.warn('[auth] signOut failed', e)),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    window.location.replace('/');
  };

  return (
    <div className="max-w-xl mx-auto flex flex-col gap-6">
      <header className="flex items-center gap-4">
        {profile?.avatarUrl ? (
          <img
            src={profile.avatarUrl}
            alt=""
            crossOrigin="anonymous"
            referrerPolicy="no-referrer"
            className="w-14 h-14 rounded-full border-2 border-text-primary"
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-text-primary" />
        )}
        <div>
          <h1 className="heading-lg">{profile?.displayName ?? 'Your profile'}</h1>
          <p className="text-text-secondary text-sm">{user?.email}</p>
        </div>
      </header>

      <RankBadge />

      <section className="card flex flex-col gap-4">
        <h2 className="heading-md">Linked accounts</h2>
        <div className="flex flex-col gap-2">
          <label className="label">Lichess username</label>
          <input
            className="input"
            placeholder="e.g. drnykterstein"
            value={lichess}
            onChange={(e) => setLichess(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="label">Chess.com username</label>
          <input
            className="input"
            placeholder="e.g. hikaru"
            value={chesscom}
            onChange={(e) => setChesscom(e.target.value)}
          />
        </div>

        <h2 className="heading-md mt-2">Sync preferences</h2>
        <p className="text-text-secondary text-sm -mt-2">
          New games are imported automatically every time you sign in, and when
          you click Sync now. These settings decide which games count.
        </p>
        <GameTypePreferences
          ratedOnly={ratedOnly}
          onRatedOnlyChange={setRatedOnly}
          timeControls={timeControls}
          onToggleTimeControl={toggleTimeControl}
        />

        <div className="flex items-center gap-3 mt-2">
          <button className="btn-primary" onClick={onSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {savedAt && Date.now() - savedAt < 4000 && (
            <span className="text-correct text-sm">Saved.</span>
          )}
        </div>
      </section>

      <section className="card flex flex-col gap-4">
        <h2 className="heading-md">Theme</h2>
        <p className="text-text-secondary text-sm -mt-2">
          Changes apply and save instantly across every screen except the landing and sign-in pages.
        </p>
        <ThemePicker value={activeTheme} onChange={onPickTheme} />
      </section>

      {(unparsedCount > 0 || backfillProgress) && (
        <section className="card flex flex-col gap-3">
          <h2 className="heading-md">Game data backfill</h2>
          <p className="text-text-secondary text-sm">
            Re-parse stored PGNs to extract opening codes, ratings, and clock data so insight cards can use them.
          </p>
          {backfillProgress && (
            <div className="flex flex-col gap-2">
              <div className="h-2 rounded-none bg-text-primary/10 overflow-hidden border border-text-primary/20">
                <div
                  className="h-full bg-gold-dark transition-[width] duration-150"
                  style={{
                    width: `${
                      backfillProgress.total === 0
                        ? 0
                        : Math.min(
                            100,
                            Math.round(
                              ((backfillProgress.processed + backfillProgress.failed) /
                                backfillProgress.total) *
                                100,
                            ),
                          )
                    }%`,
                  }}
                />
              </div>
              <p className="text-text-secondary text-xs tabular-nums">
                {backfillProgress.processed}/{backfillProgress.total} processed
                {backfillProgress.failed > 0 ? ` · ${backfillProgress.failed} failed` : ''}
              </p>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              className="btn-primary"
              disabled={backfillRunning || unparsedCount === 0}
              onClick={() => void onBackfill()}
            >
              {backfillRunning
                ? 'Backfilling…'
                : unparsedCount === 0
                  ? 'Up to date'
                  : `Backfill ${unparsedCount} game${unparsedCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </section>
      )}

      {recentSessions.data && recentSessions.data.length > 0 && (
        <section className="card flex flex-col gap-3">
          <h2 className="heading-md">Recent sessions</h2>
          <ul className="flex flex-col divide-y divide-text-primary/15">
            {recentSessions.data.map((s) => {
              const ended = s.endedAt ?? s.startedAt;
              const duration = Math.max(
                0,
                Math.round((ended.getTime() - s.startedAt.getTime()) / 1000),
              );
              const recall = s.blundersAttempted > 0
                ? Math.round((s.blundersCorrect / s.blundersAttempted) * 100)
                : 0;
              return (
                <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-text-primary tabular-nums">
                    {s.startedAt.toLocaleDateString()}
                  </span>
                  <span className="text-text-secondary tabular-nums">
                    {s.blundersCorrect}/{s.blundersAttempted} · {recall}% · {Math.round(duration / 60)}m
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card flex items-center justify-between">
        <div>
          <h2 className="heading-md">Sign out</h2>
          <p className="text-text-secondary text-sm">End your session on this device.</p>
        </div>
        <button className="btn-outline" onClick={onSignOut}>
          Sign out
        </button>
      </section>
    </div>
  );
}
