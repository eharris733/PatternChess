import clsx from 'clsx';
import { useAchievements } from '../hooks/useAchievements';
import {
  ACHIEVEMENT_CATEGORY_LABEL,
  ACHIEVEMENT_CATEGORY_ORDER,
  type EvaluatedAchievement,
} from '../lib/achievements';
import { TrophyIcon } from '../components/icons/TrophyIcon';
import { CheckIcon } from '../components/icons/CheckIcon';
import { Skeleton } from '../components/Skeleton';

function AchievementTile({ a }: { a: EvaluatedAchievement }) {
  return (
    <div
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
  const { achievements, earned, total, isPending } = useAchievements();
  const fraction = total > 0 ? earned / total : 0;

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <span className="label">Achievements</span>
        <h1 className="heading-xl">Your milestones</h1>
        <p className="text-text-secondary text-sm">
          Earned by training — a quick read on your progress across consistency, mastery, and volume.
        </p>
      </header>

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
                  <AchievementTile key={a.id} a={a} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
