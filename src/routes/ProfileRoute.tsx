import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
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
import { FlairBadge, FLAIR_RING_CLASS } from '../components/FlairBadge';
import { FlairPickerModal } from '../components/FlairPicker';
import { AchievementsTrophyLink } from '../components/achievements/AchievementsTrophyLink';
import { SettingsLink } from '../components/SettingsLink';
import { flairById } from '../lib/flair';
import clsx from 'clsx';
import { GameTypePreferences } from '../components/GameTypePreferences';
import { ThemePicker } from '../components/ThemePicker';
import { PieceSetPicker } from '../components/PieceSetPicker';
import { AvatarBuilder } from '../components/avatar/AvatarBuilder';
import { MyAvatar } from '../components/avatar/PixelAvatar';
import { SettingToggleCard } from '../components/settings/SettingToggleCard';
import { EventsStateSetting } from '../components/settings/EventsStateSetting';
import {
  AutoplayPreview,
  HideInfoPreview,
  RawEvalPreview,
  ShowAnswerPreview,
  SoundsPreview,
} from '../components/settings/TrainingPrefPreviews';
import { useRecentTrainingSessions } from '../hooks/useTrainingActivity';
import { useDrillFeedbackPrefs } from '../hooks/useDrillFeedbackPrefs';
import { useCosmetics } from '../hooks/useCosmetics';
import { CommitmentPicker } from '../components/CommitmentPicker';
import { EmailRemindersSetting } from '../components/EmailRemindersSetting';
import { SupporterSetting } from '../components/SupporterSetting';

/** In-page sections, in order; the chips at the top jump to them (also reachable as /profile#<id>). */
const SECTIONS = [
  { id: 'settings', label: 'Accounts' },
  { id: 'commitment', label: 'Daily plan' },
  { id: 'training', label: 'Training' },
  { id: 'look', label: 'Look' },
  { id: 'email', label: 'Email' },
  { id: 'supporter', label: 'Supporter' },
  { id: 'community', label: 'Community' },
] as const;

export function ProfileRoute() {
  const { profile, refreshProfile, user } = useAuth();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [flairOpen, setFlairOpen] = useState(false);
  // Router doesn't scroll to hashes: the sidebar / header gear links to
  // /profile#settings, the plan to #commitment, rewards to #look. Re-runs on
  // each click (location.key changes). Instant, not smooth: a smooth scroll is
  // cancelled by the layout shifts while the profile's cards load.
  useEffect(() => {
    if (!profile || !location.hash) return;
    const el = document.getElementById(location.hash.slice(1));
    el?.scrollIntoView({ block: 'start' });
  }, [location.hash, location.key, profile?.id]);

  const cosmetics = useCosmetics();
  const [lichess, setLichess] = useState('');
  const [chesscom, setChesscom] = useState('');
  const [ratedOnly, setRatedOnly] = useState(false);
  const [timeControls, setTimeControls] = useState<TimeControlCategory[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<BackfillProgress | null>(null);
  const [trainingPrefsError, setTrainingPrefsError] = useState<string | null>(null);
  // Optimistic copy of the training toggles: the switch flips instantly,
  // the write runs in the background, and a failure reverts the flip.
  const [trainingPrefs, setTrainingPrefs] = useState({
    showEngineEvals: false,
    revealBeforeSolve: false,
    soundsEnabled: true,
    leaderboardOptOut: false,
  });
  useEffect(() => {
    setTrainingPrefs({
      showEngineEvals: profile?.showEngineEvals ?? false,
      revealBeforeSolve: profile?.revealBeforeSolve ?? false,
      soundsEnabled: profile?.soundsEnabled ?? true,
      leaderboardOptOut: profile?.leaderboardOptOut ?? false,
    });
  }, [
    profile?.showEngineEvals,
    profile?.revealBeforeSolve,
    profile?.soundsEnabled,
    profile?.leaderboardOptOut,
  ]);

  const drillPrefs = useDrillFeedbackPrefs();

  const onToggleTrainingPref = (
    pref:
      | 'showEngineEvals'
      | 'revealBeforeSolve'
      | 'soundsEnabled'
      | 'leaderboardOptOut',
    value: boolean,
  ) => {
    if (!profile) return;
    setTrainingPrefsError(null);
    setTrainingPrefs((cur) => ({ ...cur, [pref]: value }));
    void authService
      .updateTrainingPrefs(profile.id, { [pref]: value })
      .then(() => refreshProfile())
      .catch((err) => {
        console.warn('[profile] persist training prefs failed', err);
        setTrainingPrefs((cur) => ({ ...cur, [pref]: !value }));
        setTrainingPrefsError('Could not save this preference. Try again.');
      });
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

  const flair = flairById(profile?.flair);
  const ring = flair ? clsx('ring-2 ring-offset-2 ring-offset-surface', FLAIR_RING_CLASS[flair.tone]) : null;
  const hideExtraInfo = !trainingPrefs.revealBeforeSolve;

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <header className="flex items-center gap-4">
        <a href="#look" aria-label="Edit your avatar" className="shrink-0" data-testid="profile-avatar">
          <MyAvatar className={clsx('w-14 h-14 border-2 border-text-primary', ring)} />
        </a>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="heading-lg min-w-0 truncate">{profile?.displayName ?? 'Your profile'}</h1>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <AchievementsTrophyLink />
              <SettingsLink />
            </div>
          </div>
          <button
            type="button"
            onClick={() => setFlairOpen(true)}
            aria-label={flair ? `Flair: ${flair.title}. Change flair` : 'Choose flair'}
            data-testid="flair-open"
            className="self-start transition-opacity hover:opacity-80"
          >
            {flair ? (
              <FlairBadge flair={profile?.flair} size="md" />
            ) : (
              <span className="inline-flex items-center border border-dashed border-text-primary/40 px-2 py-0.5 font-mono text-xs uppercase text-text-primary">
                Choose flair
              </span>
            )}
          </button>
          <p className="text-text-primary text-sm">{user?.email}</p>
        </div>
      </header>
      {flairOpen && <FlairPickerModal onClose={() => setFlairOpen(false)} />}

      <RankBadge />

      <nav aria-label="Profile sections" className="flex flex-wrap gap-1.5" data-testid="profile-sections">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="border-2 border-text-primary/40 bg-surface px-2.5 py-1 font-mono text-xs uppercase tracking-tight text-text-primary transition-colors hover:border-text-primary"
          >
            {s.label}
          </a>
        ))}
      </nav>

      <section id="settings" className="card flex flex-col gap-4 scroll-mt-6">
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

        <h3 className="heading-md mt-2">Sync preferences</h3>
        <p className="text-text-primary text-sm -mt-2">
          New games come in every time you sign in, and when you click Sync now. These settings
          decide which games count.
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

      <section id="commitment" className="card flex flex-col gap-4 scroll-mt-6">
        <h2 className="heading-md">Daily commitment</h2>
        <p className="text-text-primary text-sm -mt-2">
          Sets today's plan on the dashboard. Changes save instantly.
        </p>
        <CommitmentPicker />
      </section>

      <section id="training" className="card flex flex-col gap-4 scroll-mt-6">
        <h2 className="heading-md">Training</h2>
        <p className="text-text-primary text-sm -mt-2">
          What each position shows you. The pictures show the current setting; changes save instantly.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SettingToggleCard
            testId="pref-hide-info"
            title="Hide extra info when solving"
            checked={hideExtraInfo}
            onChange={(checked) => onToggleTrainingPref('revealBeforeSolve', !checked)}
            preview={<HideInfoPreview hidden={hideExtraInfo} />}
            description="Keeps the move you played, its refutation and the win chances hidden until you've moved, like a real game."
          />
          <SettingToggleCard
            testId="pref-raw-evals"
            title="Show raw engine evals"
            checked={trainingPrefs.showEngineEvals}
            onChange={(checked) => onToggleTrainingPref('showEngineEvals', checked)}
            preview={<RawEvalPreview on={trainingPrefs.showEngineEvals} />}
            description="Adds the engine number (+1.2) next to the win chances."
          />
          <SettingToggleCard
            testId="pref-show-answer"
            title="Show the answer after a miss"
            checked={drillPrefs.showAnswer}
            onChange={(checked) => drillPrefs.setShowAnswer(checked)}
            preview={<ShowAnswerPreview on={drillPrefs.showAnswer} />}
            description="Draws the best move and adds the solution line. Also in the gear on the board."
          />
          <SettingToggleCard
            testId="pref-autoplay"
            title="Autoplay the lines after a miss"
            checked={drillPrefs.autoplay}
            onChange={(checked) => drillPrefs.setAutoplay(checked)}
            preview={<AutoplayPreview on={drillPrefs.autoplay} />}
            description="Plays out why your move fails, then the solution when the answer is on. Tap the board to stop."
          />
          <SettingToggleCard
            testId="pref-sounds"
            title="Play sounds"
            checked={trainingPrefs.soundsEnabled}
            onChange={(checked) => onToggleTrainingPref('soundsEnabled', checked)}
            preview={<SoundsPreview on={trainingPrefs.soundsEnabled} />}
            description="Move, capture and check sounds, plus a cue when you solve, miss or unlock something."
          />
        </div>
        {(trainingPrefsError ?? drillPrefs.error) && (
          <p className="text-incorrect text-sm">{trainingPrefsError ?? drillPrefs.error}</p>
        )}
      </section>

      <section id="look" className="card flex flex-col gap-5 scroll-mt-6" data-testid="look-section">
        <div className="flex flex-col gap-1">
          <h2 className="heading-md">Look</h2>
          <p className="text-text-primary text-sm">
            Your avatar shows in the sidebar and on leaderboards. New themes, pieces and avatar
            extras unlock as you climb your path. Changes save instantly, except the avatar, which
            saves when you press Use this avatar.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="label">Avatar</h3>
          {profile && (
            <AvatarBuilder
              value={cosmetics.avatar}
              custom={profile.avatar != null}
              seed={profile.id}
              lockHint={cosmetics.lockHint}
              onSave={cosmetics.saveAvatar}
            />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="label">Theme</h3>
          <ThemePicker
            value={cosmetics.theme}
            onChange={cosmetics.pickTheme}
            locked={(theme) => (theme === cosmetics.theme ? null : cosmetics.lockHint({ kind: 'theme', id: theme }))}
          />
          <p className="text-text-primary text-xs">The landing and sign-in pages keep the default look.</p>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="label">Pieces</h3>
          <PieceSetPicker
            value={cosmetics.pieceSet}
            onChange={cosmetics.pickPieceSet}
            locked={(set) => (set === cosmetics.pieceSet ? null : cosmetics.lockHint({ kind: 'pieceSet', id: set }))}
          />
        </div>
        {cosmetics.error && <p className="text-incorrect text-sm">{cosmetics.error}</p>}
      </section>

      <EmailRemindersSetting />


      <SupporterSetting />

      <section id="community" className="card flex flex-col gap-4 scroll-mt-6">
        <h2 className="heading-md">Community</h2>
        <p className="text-text-primary text-sm -mt-2">
          Leaderboards show your Lichess or Chess.com username (or your display name) and your
          avatar, never your email. The weekly top 5 also appears on the public homepage, by chess
          username only.
        </p>
        <SettingToggleCard
          testId="pref-leaderboards"
          title="Show me on leaderboards"
          checked={!trainingPrefs.leaderboardOptOut}
          onChange={(checked) => onToggleTrainingPref('leaderboardOptOut', !checked)}
          description="Turn off to drop off every board (the homepage one within an hour). Your own stats and achievements stay."
        />
        <EventsStateSetting />
      </section>

      {(unparsedCount > 0 || backfillProgress) && (
        <section className="card flex flex-col gap-3">
          <h2 className="heading-md">Game data backfill</h2>
          <p className="text-text-primary text-sm">
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
              <p className="text-text-primary text-xs tabular-nums">
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
                  <span className="text-text-primary tabular-nums">
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
          <p className="text-text-primary text-sm">End your session on this device.</p>
        </div>
        <button className="btn-outline" onClick={onSignOut}>
          Sign out
        </button>
      </section>
    </div>
  );
}
