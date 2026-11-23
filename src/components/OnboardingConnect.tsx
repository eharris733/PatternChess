import { useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { authService } from '../services/authService';
import { ALL_TIME_CONTROLS, type TimeControlCategory } from '../services/chessApiService';
import { BrandLockup } from './BrandLogo';
import { readDemoUser } from '../lib/demoUser';
import { GameTypePreferences } from './GameTypePreferences';
import { ChesscomLogo, LichessLogo } from './icons/PlatformLogos';
import { useT } from '../i18n/useT';

/**
 * First step of the new-user onboarding flow: connect a Lichess/Chess.com
 * account and choose which games to train on. Saving a username flips the
 * profile, which auto-triggers sync in AuthProvider and advances the flow to
 * the import-progress step.
 */
export function OnboardingConnect() {
  const { profile, refreshProfile } = useAuth();
  const t = useT();
  // Prefill from the landing demo, if this visitor ran one before signing up.
  const [demoUser] = useState(readDemoUser);
  const [lichess, setLichess] = useState(
    profile?.lichessUsername ?? (demoUser?.platform === 'lichess' ? demoUser.username : ''),
  );
  const [chesscom, setChesscom] = useState(
    profile?.chesscomUsername ?? (demoUser?.platform === 'chesscom' ? demoUser.username : ''),
  );
  const [ratedOnly, setRatedOnly] = useState(profile?.preferredRatedOnly ?? true);
  const [timeControls, setTimeControls] = useState<TimeControlCategory[]>(
    profile?.preferredTimeControls?.length
      ? profile.preferredTimeControls
      : [...ALL_TIME_CONTROLS],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleTimeControl = (value: TimeControlCategory) => {
    setTimeControls((cur) =>
      cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value],
    );
  };

  const canStart = !!(lichess.trim() || chesscom.trim());

  const onStart = async () => {
    if (!profile || !canStart || saving) return;
    setSaving(true);
    setError(null);
    try {
      await authService.updateProfile({
        ...profile,
        lichessUsername: lichess.trim() || null,
        chesscomUsername: chesscom.trim() || null,
        preferredRatedOnly: ratedOnly,
        preferredTimeControls: timeControls,
      });
      // Claiming pre-existing anonymous games is best-effort — a failure here must
      // not block advancing into the import step.
      try {
        if (lichess.trim()) await authService.claimAnonymousData(lichess.trim());
        if (chesscom.trim()) await authService.claimAnonymousData(chesscom.trim());
      } catch (e) {
        console.warn('[onboarding] claimAnonymousData failed (non-fatal)', e);
      }
      await refreshProfile();
    } catch (e) {
      console.error('[onboarding] could not start import', e);
      setError(t('onboarding.connect.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-center min-h-[60vh] max-w-xl mx-auto">
      <BrandLockup size="lg" className="mb-4" />
      <p className="text-text-primary mb-8 text-center">
        {t('onboarding.connect.lede')}
      </p>

      <div className="w-full space-y-5 bg-surface rounded-none p-6 border-2 border-text-primary shadow-card">
        <div className="flex flex-col gap-2">
          <label className="label flex items-center gap-2" htmlFor="onboarding-lichess">
            <LichessLogo className="h-4 w-4 shrink-0" />
            {t('profile.lichessUsername')}
          </label>
          <input
            id="onboarding-lichess"
            className="input"
            placeholder={t('profile.examplePlaceholder', { name: 'drnykterstein' })}
            value={lichess}
            onChange={(e) => setLichess(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="label flex items-center gap-2" htmlFor="onboarding-chesscom">
            <ChesscomLogo className="h-4 w-4 shrink-0" />
            {t('profile.chesscomUsername')}
          </label>
          <input
            id="onboarding-chesscom"
            className="input"
            placeholder={t('profile.examplePlaceholder', { name: 'hikaru' })}
            value={chesscom}
            onChange={(e) => setChesscom(e.target.value)}
          />
        </div>

        <div className="pt-2 border-t-2 border-text-primary/15">
          <h2 className="heading-md mb-1">{t('onboarding.connect.whichGames')}</h2>
          <p className="text-text-primary text-sm mb-3">
            {t('onboarding.connect.whichGamesHelp')}
          </p>
          <GameTypePreferences
            ratedOnly={ratedOnly}
            onRatedOnlyChange={setRatedOnly}
            timeControls={timeControls}
            onToggleTimeControl={toggleTimeControl}
          />
        </div>
      </div>

      <p className="mt-4 text-xs text-text-primary text-center">
        {t('onboarding.connect.importNote')}
      </p>

      <button
        type="button"
        onClick={onStart}
        disabled={!canStart || saving}
        className="btn-primary mt-6"
      >
        {saving ? t('onboarding.connect.starting') : t('onboarding.connect.build')}
      </button>

      {error && (
        <div className="mt-4 w-full bg-incorrect/10 border-2 border-incorrect/50 text-incorrect rounded-none p-4 text-sm text-left">
          <div className="font-semibold mb-1">{t('onboarding.somethingWrong')}</div>
          <div className="text-text-primary">{error}</div>
        </div>
      )}
    </div>
  );
}
