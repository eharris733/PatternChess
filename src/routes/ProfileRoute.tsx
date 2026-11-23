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
import { LanguageSetting } from '../components/settings/LanguageSetting';
import { useT } from '../i18n/useT';
import type { MessageKey } from '../i18n/i18n';

/** In-page sections, in order; the chips at the top jump to them (also reachable as /profile#<id>). */
const SECTIONS: readonly { id: string; label: MessageKey }[] = [
  { id: 'settings', label: 'profile.section.accounts' },
  { id: 'commitment', label: 'profile.section.dailyPlan' },
  { id: 'training', label: 'profile.section.training' },
  { id: 'look', label: 'profile.section.look' },
  { id: 'language', label: 'profile.section.language' },
  { id: 'email', label: 'profile.section.email' },
  { id: 'supporter', label: 'profile.section.supporter' },
  { id: 'community', label: 'profile.section.community' },
];

export function ProfileRoute() {
  const { profile, refreshProfile, user } = useAuth();
  const t = useT();
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
        setTrainingPrefsError(t('profile.prefSaveError'));
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
        <a href="#look" aria-label={t('profile.editAvatar')} className="shrink-0" data-testid="profile-avatar">
          <MyAvatar className={clsx('w-14 h-14 border-2 border-text-primary', ring)} />
        </a>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="heading-lg min-w-0 truncate">{profile?.displayName ?? t('profile.yourProfile')}</h1>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <AchievementsTrophyLink />
              <SettingsLink />
            </div>
          </div>
          <button
            type="button"
            onClick={() => setFlairOpen(true)}
            aria-label={flair ? t('profile.flairChange', { title: flair.title }) : t('profile.chooseFlair')}
            data-testid="flair-open"
            className="self-start transition-opacity hover:opacity-80"
          >
            {flair ? (
              <FlairBadge flair={profile?.flair} size="md" />
            ) : (
              <span className="inline-flex items-center border border-dashed border-text-primary/40 px-2 py-0.5 font-mono text-xs uppercase text-text-primary">
                {t('profile.chooseFlair')}
              </span>
            )}
          </button>
          <p className="text-text-primary text-sm">{user?.email}</p>
        </div>
      </header>
      {flairOpen && <FlairPickerModal onClose={() => setFlairOpen(false)} />}

      <RankBadge />

      <nav aria-label={t('profile.sectionsNav')} className="flex flex-wrap gap-1.5" data-testid="profile-sections">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="border-2 border-text-primary/40 bg-surface px-2.5 py-1 font-mono text-xs uppercase tracking-tight text-text-primary transition-colors hover:border-text-primary"
          >
            {t(s.label)}
          </a>
        ))}
      </nav>

      <section id="settings" className="card flex flex-col gap-4 scroll-mt-6">
        <h2 className="heading-md">{t('profile.linkedAccounts')}</h2>
        <div className="flex flex-col gap-2">
          <label className="label" htmlFor="profile-lichess-username">{t('profile.lichessUsername')}</label>
          <input
            id="profile-lichess-username"
            className="input"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('profile.examplePlaceholder', { name: 'drnykterstein' })}
            value={lichess}
            onChange={(e) => setLichess(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="label" htmlFor="profile-chesscom-username">{t('profile.chesscomUsername')}</label>
          <input
            id="profile-chesscom-username"
            className="input"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('profile.examplePlaceholder', { name: 'hikaru' })}
            value={chesscom}
            onChange={(e) => setChesscom(e.target.value)}
          />
        </div>

        <h3 className="heading-md mt-2">{t('profile.syncPrefs')}</h3>
        <p className="text-text-primary text-sm -mt-2">
          {t('profile.syncPrefsHelp')}
        </p>
        <GameTypePreferences
          ratedOnly={ratedOnly}
          onRatedOnlyChange={setRatedOnly}
          timeControls={timeControls}
          onToggleTimeControl={toggleTimeControl}
        />

        <div className="flex items-center gap-3 mt-2">
          <button className="btn-primary" onClick={onSave} disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </button>
          {savedAt && Date.now() - savedAt < 4000 && (
            <span className="text-correct text-sm">{t('profile.savedDot')}</span>
          )}
        </div>
      </section>

      <section id="commitment" className="card flex flex-col gap-4 scroll-mt-6">
        <h2 className="heading-md">{t('profile.dailyCommitment')}</h2>
        <p className="text-text-primary text-sm -mt-2">
          {t('profile.dailyCommitmentHelp')}
        </p>
        <CommitmentPicker />
      </section>

      <section id="training" className="card flex flex-col gap-4 scroll-mt-6">
        <h2 className="heading-md">{t('profile.section.training')}</h2>
        <p className="text-text-primary text-sm -mt-2">
          {t('profile.trainingHelp')}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SettingToggleCard
            testId="pref-hide-info"
            title={t('profile.pref.hideInfo.title')}
            checked={hideExtraInfo}
            onChange={(checked) => onToggleTrainingPref('revealBeforeSolve', !checked)}
            preview={<HideInfoPreview hidden={hideExtraInfo} />}
            description={t('profile.pref.hideInfo.desc')}
          />
          <SettingToggleCard
            testId="pref-raw-evals"
            title={t('profile.pref.rawEvals.title')}
            checked={trainingPrefs.showEngineEvals}
            onChange={(checked) => onToggleTrainingPref('showEngineEvals', checked)}
            preview={<RawEvalPreview on={trainingPrefs.showEngineEvals} />}
            description={t('profile.pref.rawEvals.desc')}
          />
          <SettingToggleCard
            testId="pref-show-answer"
            title={t('profile.pref.showAnswer.title')}
            checked={drillPrefs.showAnswer}
            onChange={(checked) => drillPrefs.setShowAnswer(checked)}
            preview={<ShowAnswerPreview on={drillPrefs.showAnswer} />}
            description={t('profile.pref.showAnswer.desc')}
          />
          <SettingToggleCard
            testId="pref-autoplay"
            title={t('profile.pref.autoplay.title')}
            checked={drillPrefs.autoplay}
            onChange={(checked) => drillPrefs.setAutoplay(checked)}
            preview={<AutoplayPreview on={drillPrefs.autoplay} />}
            description={t('profile.pref.autoplay.desc')}
          />
          <SettingToggleCard
            testId="pref-sounds"
            title={t('profile.pref.sounds.title')}
            checked={trainingPrefs.soundsEnabled}
            onChange={(checked) => onToggleTrainingPref('soundsEnabled', checked)}
            preview={<SoundsPreview on={trainingPrefs.soundsEnabled} />}
            description={t('profile.pref.sounds.desc')}
          />
        </div>
        {(trainingPrefsError ?? drillPrefs.error) && (
          <p className="text-incorrect text-sm">{trainingPrefsError ?? drillPrefs.error}</p>
        )}
      </section>

      <section id="look" className="card flex flex-col gap-5 scroll-mt-6" data-testid="look-section">
        <div className="flex flex-col gap-1">
          <h2 className="heading-md">{t('profile.section.look')}</h2>
          <p className="text-text-primary text-sm">
            {t('profile.look.help')}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="label">{t('profile.look.avatar')}</h3>
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
          <h3 className="label">{t('profile.look.theme')}</h3>
          <ThemePicker
            value={cosmetics.theme}
            onChange={cosmetics.pickTheme}
            locked={(theme) => (theme === cosmetics.theme ? null : cosmetics.lockHint({ kind: 'theme', id: theme }))}
          />
          <p className="text-text-primary text-xs">{t('profile.look.themeNote')}</p>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="label">{t('profile.look.pieces')}</h3>
          <PieceSetPicker
            value={cosmetics.pieceSet}
            onChange={cosmetics.pickPieceSet}
            locked={(set) => (set === cosmetics.pieceSet ? null : cosmetics.lockHint({ kind: 'pieceSet', id: set }))}
          />
        </div>
        {cosmetics.error && <p className="text-incorrect text-sm">{cosmetics.error}</p>}
      </section>

      <LanguageSetting />

      <EmailRemindersSetting />


      <SupporterSetting />

      <section id="community" className="card flex flex-col gap-4 scroll-mt-6">
        <h2 className="heading-md">{t('profile.section.community')}</h2>
        <p className="text-text-primary text-sm -mt-2">
          {t('profile.community.help')}
        </p>
        <SettingToggleCard
          testId="pref-leaderboards"
          title={t('profile.pref.leaderboards.title')}
          checked={!trainingPrefs.leaderboardOptOut}
          onChange={(checked) => onToggleTrainingPref('leaderboardOptOut', !checked)}
          description={t('profile.pref.leaderboards.desc')}
        />
        <EventsStateSetting />
      </section>

      {(unparsedCount > 0 || backfillProgress) && (
        <section className="card flex flex-col gap-3">
          <h2 className="heading-md">{t('profile.backfill.title')}</h2>
          <p className="text-text-primary text-sm">
            {t('profile.backfill.help')}
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
                {t('profile.backfill.processed', {
                  processed: backfillProgress.processed,
                  total: backfillProgress.total,
                })}
                {backfillProgress.failed > 0
                  ? ` · ${t('profile.backfill.failed', { count: backfillProgress.failed })}`
                  : ''}
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
                ? t('profile.backfill.running')
                : unparsedCount === 0
                  ? t('profile.backfill.upToDate')
                  : t('profile.backfill.action', { count: unparsedCount })}
            </button>
          </div>
        </section>
      )}

      {recentSessions.data && recentSessions.data.length > 0 && (
        <section className="card flex flex-col gap-3">
          <h2 className="heading-md">{t('profile.recentSessions')}</h2>
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
          <h2 className="heading-md">{t('profile.signOut')}</h2>
          <p className="text-text-primary text-sm">{t('profile.signOutHelp')}</p>
        </div>
        <button className="btn-outline" onClick={onSignOut}>
          {t('profile.signOut')}
        </button>
      </section>
    </div>
  );
}
