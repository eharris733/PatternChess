import clsx from 'clsx';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { useAchievements } from '../hooks/useAchievements';
import { authService } from '../services/authService';
import {
  ACHIEVEMENT_CATEGORY_LABEL,
  ACHIEVEMENT_CATEGORY_ORDER,
  type EvaluatedAchievement,
} from '../lib/achievements';
import { TrophyIcon } from '../components/icons/TrophyIcon';
import { CheckIcon } from '../components/icons/CheckIcon';
import { InstagramIcon } from '../components/icons/InstagramIcon';
import { Skeleton } from '../components/Skeleton';
import { LeaderboardPanel } from '../components/achievements/LeaderboardPanel';

type Tab = 'achievements' | 'leaderboards';

function AchievementTile({
  a,
  onAction,
}: {
  a: EvaluatedAchievement;
  onAction?: (a: EvaluatedAchievement) => void;
}) {
  return (
    <div
      data-testid={`achievement-${a.id}`}
      className={clsx(
        'flex flex-col gap-2 rounded-none border-2 border-text-primary p-4',
        a.earned ? 'bg-surface-3' : 'bg-surface opacity-80',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={clsx('shrink-0', a.earned ? 'text-gold-dark' : 'text-text-secondary/50')}>
          <TrophyIcon className="h-6 w-6" />
        </span>
        {a.earned ? (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-tight text-correct">
            <CheckIcon className="h-3.5 w-3.5" />
            Unlocked
          </span>
        ) : (
          <span className="text-text-secondary text-xs tabular-nums">
            {Math.min(a.value, a.threshold).toLocaleString()}/{a.threshold.toLocaleString()}
          </span>
        )}
      </div>
      <div>
        <p className="font-mono text-sm uppercase tracking-tight text-text-primary">{a.title}</p>
        <p className="text-text-secondary text-xs mt-0.5">{a.description}</p>
      </div>
      {!a.earned && a.action && (
        <a
          href={a.action.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onAction?.(a)}
          className="btn-outline inline-flex items-center gap-2 self-start text-xs"
        >
          <InstagramIcon className="h-4 w-4" />
          {a.action.label}
        </a>
      )}
      {!a.earned && (
        <div className="mt-auto h-1.5 overflow-hidden rounded-none border border-text-primary/20 bg-text-primary/10">
          <div
            className="h-full bg-gold-dark transition-[width] duration-300"
            style={{ width: `${Math.round(a.fraction * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function AchievementsRoute() {
  const { profile, refreshProfile } = useAuth();
  const { achievements, earned, total, isPending } = useAchievements();
  const fraction = total > 0 ? earned / total : 0;
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'leaderboards' ? 'leaderboards' : 'achievements';
  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params);
    if (next === 'achievements') p.delete('tab');
    else p.set('tab', next);
    setParams(p, { replace: true });
  };

  // The only tile action today is the Instagram follow: the click opens the
  // link (new tab) and flags the profile so the achievement unlocks.
  const onTileAction = (a: EvaluatedAchievement) => {
    if (!profile || a.id !== 'follow-instagram') return;
    void authService
      .markFollowedInstagram(profile.id)
      .then(() => refreshProfile())
      .catch((err) => console.warn('[achievements] persist followed_instagram failed', err));
  };

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <span className="label">Achievements</span>
        <h1 className="heading-xl">
          {tab === 'achievements' ? 'Your milestones' : 'Leaderboards'}
        </h1>
        <p className="text-text-secondary text-sm">
          {tab === 'achievements'
            ? 'Earned by training — a quick read on your progress across consistency, mastery, and volume.'
            : 'How your training stacks up against everyone else on PatternChess.'}
        </p>
      </header>

      <div role="tablist" aria-label="Achievements or leaderboards" className="flex gap-1.5">
        {(
          [
            ['achievements', 'Achievements'],
            ['leaderboards', 'Leaderboards'],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            data-testid={`tab-${id}`}
            onClick={() => setTab(id)}
            className={clsx(
              'px-4 py-2 text-sm font-mono uppercase tracking-tight border-2 rounded-none transition-colors',
              tab === id
                ? 'bg-text-primary text-bg border-text-primary'
                : 'bg-surface text-text-primary border-text-primary hover:bg-accent/15',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'leaderboards' ? (
        <LeaderboardPanel />
      ) : (
        <>
          <section className="card flex flex-col gap-3">
            <header className="flex items-baseline justify-between">
              <span className="label">Unlocked</span>
              {isPending ? (
                <Skeleton className="h-4 w-16" />
              ) : (
                <span className="text-text-secondary text-sm tabular-nums">
                  <span className="font-mono text-text-primary">{earned}</span> / {total}
                </span>
              )}
            </header>
            <div className="h-2 overflow-hidden rounded-none border border-text-primary/20 bg-text-primary/10">
              <div
                className="h-full bg-gold-dark transition-[width] duration-300"
                style={{ width: `${Math.round(fraction * 100)}%` }}
              />
            </div>
          </section>

          {isPending ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-28 w-full" />
              ))}
            </div>
          ) : (
            ACHIEVEMENT_CATEGORY_ORDER.map((category) => {
              const items = achievements.filter((a) => a.category === category);
              if (items.length === 0) return null;
              const earnedInCat = items.filter((a) => a.earned).length;
              return (
                <section key={category} className="flex flex-col gap-3">
                  <header className="flex items-baseline justify-between">
                    <h2 className="heading-md">{ACHIEVEMENT_CATEGORY_LABEL[category]}</h2>
                    <span className="text-text-secondary text-xs tabular-nums">
                      {earnedInCat}/{items.length}
                    </span>
                  </header>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {items.map((a) => (
                      <AchievementTile key={a.id} a={a} onAction={onTileAction} />
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </>
      )}
    </div>
  );
}
