import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useAuth } from '../auth/useAuth';
import { useAchievements } from '../hooks/useAchievements';
import { useSupporter } from '../hooks/useSupporter';
import { evaluateFlairs, FLAIR_TRACK_LABEL, FLAIR_TRACK_ORDER } from '../lib/flair';
import { achievementProgressLabel } from '../lib/achievements';
import { authService } from '../services/authService';
import { FlairBadge } from './FlairBadge';
import { Skeleton } from './Skeleton';
import { CloseIcon } from './icons/CloseIcon';
import { LockIcon } from './icons/LockIcon';
import { useT } from '../i18n/useT';
import { openSupporterUnlock } from '../state/supporterUnlockStore';

/**
 * Pick the flair shown next to your name (profile header and leaderboards),
 * in a modal opened from the profile header's badge. Locked flairs show what
 * unlocks them and how close you are.
 */
export function FlairPickerModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose your flair"
      onClick={onClose}
    >
      <div
        className="card relative max-w-xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close"
          className="btn-ghost absolute top-3 right-3 p-1 text-text-primary hover:text-text-primary"
          onClick={onClose}
        >
          <CloseIcon className="h-5 w-5" />
        </button>
        <FlairPickerGrid />
      </div>
    </div>
  );
}

function FlairPickerGrid() {
  const t = useT();
  const { profile, refreshProfile } = useAuth();
  const { achievements, isPending } = useAchievements();
  const [selected, setSelected] = useState<string | null>(profile?.flair ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setSelected(profile?.flair ?? null), [profile?.flair]);

  const { status: supporter } = useSupporter();
  const flairs = evaluateFlairs(achievements, {
    active: !!supporter?.active,
    early: !!supporter?.early,
  });
  const unlockedCount = flairs.filter((f) => f.unlocked).length;

  const choose = (id: string | null) => {
    if (!profile || id === selected) return;
    const prev = selected;
    setSelected(id);
    setError(null);
    void authService
      .setFlair(profile.id, id)
      .then(() => refreshProfile())
      .catch((err) => {
        console.warn('[profile] set flair failed', err);
        setSelected(prev);
        setError("Couldn't save your flair. Try again.");
      });
  };

  return (
    <section className="flex flex-col gap-4" data-testid="flair-picker">
      <header className="flex items-baseline gap-3 pr-10">
        <h2 className="heading-md">Flair</h2>
        <span className="text-text-primary text-xs">
          {unlockedCount}/{flairs.length} unlocked
        </span>
      </header>
      <p className="text-text-primary text-sm">
        Earned by training regularly and putting in the hours. Your pick shows next to your name on
        leaderboards.
      </p>
      {isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <>
          {FLAIR_TRACK_ORDER.map((track) => (
            <div key={track} className="flex flex-col gap-2">
              <span className="label">{FLAIR_TRACK_LABEL[track]}</span>
              <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {flairs
                  .filter((f) => f.track === track)
                  .map((f) => {
                    const active = selected === f.id;
                    const req = f.requirement;
                    return (
                      <li key={f.id}>
                        <button
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            f.unlocked
                              ? choose(f.id)
                              : openSupporterUnlock({
                                  item: t('supporterUnlock.flair', { name: f.title }),
                                  earnHint: f.track === 'supporter' ? null : t('supporterUnlock.flairEarn'),
                                })
                          }
                          data-testid={`flair-option-${f.id}`}
                          data-locked={!f.unlocked || undefined}
                          className={clsx(
                            'w-full h-full flex flex-col items-start gap-1.5 border-2 p-2 text-left transition-colors',
                            active ? 'border-accent bg-accent/10' : 'border-text-primary/20',
                            f.unlocked ? 'hover:border-accent' : 'hover:border-text-primary/60',
                          )}
                        >
                          <span className={clsx('flex items-center gap-1', !f.unlocked && 'opacity-60')}>
                            {!f.unlocked && <LockIcon className="h-3.5 w-3.5" />}
                            <FlairBadge flair={f.id} size="md" />
                          </span>
                          <span className="text-text-primary text-[11px] leading-snug">
                            {f.unlocked
                              ? active
                                ? 'Showing'
                                : 'Unlocked'
                              : req
                                ? `${req.description} (${achievementProgressLabel(req)})`
                                : f.track === 'supporter'
                                  ? t('supporterUnlock.forSupporters')
                                  : 'Locked'}
                          </span>
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
          <button
            type="button"
            className="btn-ghost self-start text-xs"
            onClick={() => choose(null)}
            disabled={selected == null}
            data-testid="flair-none"
          >
            Show no flair
          </button>
        </>
      )}
      {error && <p className="text-incorrect text-sm">{error}</p>}
    </section>
  );
}
