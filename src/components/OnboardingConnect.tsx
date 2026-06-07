import { useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { authService } from '../services/authService';
import { ALL_TIME_CONTROLS, type TimeControlCategory } from '../services/chessApiService';
import { BrandLockup } from './BrandLogo';
import { GameTypePreferences } from './GameTypePreferences';

/**
 * First step of the new-user onboarding flow: connect a Lichess/Chess.com
 * account and choose which games to train on. Saving a username flips the
 * profile, which auto-triggers sync in AuthProvider and advances the flow to
 * the import-progress step.
 */
export function OnboardingConnect() {
  const { profile, refreshProfile } = useAuth();
  const [lichess, setLichess] = useState(profile?.lichessUsername ?? '');
  const [chesscom, setChesscom] = useState(profile?.chesscomUsername ?? '');
  const [ratedOnly, setRatedOnly] = useState(profile?.preferredRatedOnly ?? false);
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
      setError("We couldn't save your account. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-center min-h-[60vh] max-w-xl mx-auto">
      <BrandLockup size="lg" className="mb-4" />
      <p className="text-text-secondary mb-8 text-center">
        Connect your online chess account and we'll find the blunders in your
        real games to train against.
      </p>

      <div className="w-full space-y-5 bg-surface rounded-none p-6 border-2 border-text-primary shadow-card">
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

        <div className="pt-2 border-t-2 border-text-primary/15">
          <h2 className="heading-md mb-1">Which games to train on?</h2>
          <p className="text-text-secondary text-sm mb-3">
            Pick the games that count toward training. You can change this any
            time in your profile.
          </p>
          <GameTypePreferences
            ratedOnly={ratedOnly}
            onRatedOnlyChange={setRatedOnly}
            timeControls={timeControls}
            onToggleTimeControl={toggleTimeControl}
          />
        </div>
      </div>

      <p className="mt-4 text-xs text-text-secondary text-center">
        We'll import your recent games now. After this, new games are added to
        your vault automatically every time you come back.
      </p>

      <button
        type="button"
        onClick={onStart}
        disabled={!canStart || saving}
        className="btn-primary mt-6"
      >
        {saving ? 'Starting…' : 'Start import'}
      </button>

      {error && (
        <div className="mt-4 w-full bg-incorrect/10 border-2 border-incorrect/50 text-incorrect rounded-none p-4 text-sm text-left">
          <div className="font-mono uppercase text-xs tracking-tight mb-1">
            Something went wrong
          </div>
          <div className="text-text-secondary">{error}</div>
        </div>
      )}
    </div>
  );
}
