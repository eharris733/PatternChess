import { Link } from 'react-router-dom';
import { useAchievements } from '../../hooks/useAchievements';
import { TrophyIcon } from '../icons/TrophyIcon';
import { ChevronIcon } from '../icons/ChevronIcon';
import { Skeleton } from '../Skeleton';

/** Profile entry point to /achievements: the unlocked count and meter, one click away. */
export function AchievementsLinkCard() {
  const { earned, total, isPending } = useAchievements();
  const fraction = total > 0 ? earned / total : 0;
  return (
    <Link
      to="/achievements"
      className="card flex items-center gap-4 transition-colors hover:bg-accent/10"
      data-testid="achievements-link"
    >
      <TrophyIcon className="h-7 w-7 shrink-0 text-gold-dark" />
      <div className="flex flex-1 flex-col gap-2 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="heading-md">Achievements</span>
          {isPending ? (
            <Skeleton className="h-4 w-16" />
          ) : (
            <span className="text-text-primary text-sm tabular-nums">
              <span className="font-mono font-semibold">{earned}</span> / {total} unlocked
            </span>
          )}
        </div>
        <div className="h-2 overflow-hidden rounded-none border border-text-primary/20 bg-text-primary/10">
          <div
            className="h-full bg-gold-dark transition-[width] duration-300"
            style={{ width: `${Math.round(fraction * 100)}%` }}
          />
        </div>
      </div>
      <ChevronIcon className="h-4 w-4 shrink-0 text-text-primary" />
    </Link>
  );
}
