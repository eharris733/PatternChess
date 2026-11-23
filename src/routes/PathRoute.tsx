import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { usePathProgress } from '../hooks/usePathProgress';
import { ProgressBar } from '../components/ProgressBar';
import { Skeleton } from '../components/Skeleton';
import { CheckIcon } from '../components/icons/CheckIcon';
import { HeartIcon } from '../components/icons/HeartIcon';
import { RewardPreview } from '../components/rewards/RewardPreview';
import { rewardTitle, rewardsForRung } from '../lib/rewards';

/**
 * The progression ladder: milestones on lifetime positions trained. Each rung
 * unlocks cosmetic rewards (src/lib/rewards.ts: themes, pieces, avatar
 * extras, streak freezes) and a short article (supporter-only text; everyone
 * sees the teaser). Supporters can open every rung now.
 */
export function PathRoute() {
  const path = usePathProgress();
  if (path.isPending) return <Skeleton className="h-64 w-full max-w-3xl mx-auto" />;

  const prevAt = path.reached > 0 ? path.rungs[path.reached - 1].at : 0;

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <span className="label">Your path</span>
        <h1 className="heading-xl">{path.trained.toLocaleString()} positions trained</h1>
        {path.next ? (
          <div className="flex flex-col gap-2">
            <p className="text-text-primary">
              Next unlock in <span className="font-semibold">{path.remaining}</span> position
              {path.remaining === 1 ? '' : 's'}.
            </p>
            <ProgressBar current={path.trained - prevAt} total={path.next.at - prevAt} />
          </div>
        ) : (
          <p className="text-text-primary">You've reached the top of the path. Thank you for showing up.</p>
        )}
        <p className="text-sm text-text-primary">
          Each milestone unlocks new looks for your board and avatar, and some bank a streak freeze.{' '}
          <Link to="/profile#look" className="underline">
            Change your look
          </Link>
        </p>
        {!path.isSupporter && (
          <p className="text-sm text-text-primary">
            Supporters also read a short article at each milestone, and can open every one now.{' '}
            <Link to="/supporter" className="underline">
              Become a supporter
            </Link>
          </p>
        )}
      </header>

      <ol className="flex flex-col" data-testid="path-rungs">
        {path.rungs.map((rung, i) => {
          const reached = path.trained >= rung.at;
          const isNext = i === path.reached;
          const open = reached || path.isSupporter;
          return (
            <li
              key={rung.at}
              data-testid="path-rung"
              data-state={reached ? 'reached' : isNext ? 'next' : 'locked'}
              className="relative flex gap-4 pb-6 last:pb-0"
            >
              {i < path.rungs.length - 1 && (
                <span
                  aria-hidden
                  className={clsx('absolute left-[15px] top-8 bottom-0 w-0.5', reached ? 'bg-gold-dark' : 'bg-text-primary/15')}
                />
              )}
              <span
                className={clsx(
                  'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center border-2 font-mono text-xs',
                  reached
                    ? 'border-gold-dark bg-gold-dark text-bg'
                    : isNext
                      ? 'border-gold-dark bg-surface text-gold-dark'
                      : 'border-text-primary/25 bg-surface text-text-primary',
                )}
              >
                {reached ? <CheckIcon className="h-4 w-4" /> : i + 1}
              </span>
              <div className={clsx('flex flex-1 flex-col gap-1 pt-1', !open && 'opacity-70')}>
                <span className="font-mono text-xs tabular-nums text-text-primary">
                  {rung.at.toLocaleString()} positions
                  {isNext && path.remaining != null && ` · ${path.remaining} to go`}
                </span>
                {rung.article ? (
                  open ? (
                    <Link to={`/path/${rung.article.slug}`} className="font-semibold text-text-primary underline-offset-4 hover:underline">
                      {rung.article.title}
                    </Link>
                  ) : (
                    <span className="font-semibold text-text-primary">{rung.article.title}</span>
                  )
                ) : (
                  <span className="text-text-primary">{reached ? 'Milestone reached' : 'Milestone'}</span>
                )}
                {rung.article && open && !path.isSupporter && (
                  <span className="flex items-center gap-1 text-xs text-text-primary">
                    <HeartIcon className="h-3 w-3" /> Full article for supporters
                  </span>
                )}
                {rewardsForRung(rung.at).length > 0 && (
                  <ul className="mt-1 flex flex-wrap gap-2" data-testid="rung-rewards">
                    {rewardsForRung(rung.at).map((r) => (
                      <li
                        key={r.id}
                        className={clsx(
                          'flex items-center gap-2 border-2 bg-surface px-2 py-1',
                          reached ? 'border-gold-dark' : 'border-text-primary/20',
                        )}
                      >
                        <RewardPreview item={r.item} size="sm" />
                        <span className="text-xs text-text-primary">{rewardTitle(r.item)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
