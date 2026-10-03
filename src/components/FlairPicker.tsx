import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useAuth } from '../auth/useAuth';
import { useAchievements } from '../hooks/useAchievements';
import { evaluateFlairs, FLAIR_TRACK_LABEL, FLAIR_TRACK_ORDER } from '../lib/flair';
import { authService } from '../services/authService';
import { FlairBadge } from './FlairBadge';
import { Skeleton } from './Skeleton';

/**
 * Profile section: pick the flair shown next to your name (profile header and
 * leaderboards). Locked flairs show what unlocks them and how close you are.
 */
export function FlairPicker() {
  const { profile, refreshProfile } = useAuth();
  const { achievements, isPending } = useAchievements();
  const [selected, setSelected] = useState<string | null>(profile?.flair ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setSelected(profile?.flair ?? null), [profile?.flair]);

  const flairs = evaluateFlairs(achievements);
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
    <section className="card flex flex-col gap-4" data-testid="flair-picker">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="heading-md">Flair</h2>
        <span className="text-text-secondary text-xs">
          {unlockedCount}/{flairs.length} unlocked
        </span>
      </header>
      <p className="text-text-secondary text-sm">
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
                          disabled={!f.unlocked}
                          aria-pressed={active}
                          onClick={() => choose(f.id)}
                          data-testid={`flair-option-${f.id}`}
                          className={clsx(
                            'w-full h-full flex flex-col items-start gap-1.5 border-2 p-2 text-left transition-colors',
                            active ? 'border-accent bg-accent/10' : 'border-text-primary/20',
                            f.unlocked ? 'hover:border-accent' : 'opacity-60 cursor-not-allowed',
                          )}
                        >
                          <FlairBadge flair={f.id} size="md" />
                          <span className="text-text-secondary text-[11px] leading-snug">
                            {f.unlocked
                              ? active
                                ? 'Showing'
                                : 'Unlocked'
                              : req
                                ? `${req.description} (${Math.min(req.value, req.threshold).toLocaleString()}/${req.threshold.toLocaleString()})`
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
