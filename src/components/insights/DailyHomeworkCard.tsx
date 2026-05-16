import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { useDueBlunders } from '../../hooks/useDueBlunders';
import { useDueTomorrowCount } from '../../hooks/useDueTomorrowCount';
import { useGames } from '../../hooks/useGames';
import { useCompletedToday } from '../../hooks/useTrainingActivity';
import { useSyncStore } from '../../state/syncStore';
import { usePgnUploadStore } from '../../state/pgnUploadStore';
import { DueByStage } from './DueByStage';
import { Skeleton } from '../Skeleton';

export function DailyHomeworkCard() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const dueQuery = useDueBlunders();
  const tomorrowQuery = useDueTomorrowCount();
  const gamesQuery = useGames();
  const completedTodayQuery = useCompletedToday();
  const triggerNow = useSyncStore((s) => s.triggerNow);
  const openUpload = usePgnUploadStore((s) => s.openModal);
  const isSyncing = useSyncStore((s) => {
    const busy = (phase: string) =>
      phase === 'fetching' || phase === 'inserting' || phase === 'analyzing';
    return busy(s.providers.lichess.phase) || busy(s.providers.chesscom.phase);
  });

  const isInitialLoad = dueQuery.isPending;
  const dueCount = dueQuery.data?.length ?? 0;
  const tomorrowCount = tomorrowQuery.data ?? 0;
  const gamesCount = gamesQuery.data?.length ?? 0;
  const completedToday = completedTodayQuery.data === true;
  const hasAccount = !!(profile?.lichessUsername || profile?.chesscomUsername);
  const pgnOnly = !hasAccount && gamesCount > 0;

  if (isInitialLoad) {
    return (
      <section className="card flex flex-col gap-4">
        <header className="flex items-baseline justify-between">
          <span className="label">Today's homework</span>
        </header>
        <div className="flex items-end gap-3">
          <Skeleton className="h-14 w-24" />
          <Skeleton className="h-4 w-28 mb-2" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-20" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-10 w-32" />
        </div>
      </section>
    );
  }

  if (dueCount > 0) {
    return (
      <section className="card flex flex-col gap-4">
        <header className="flex items-baseline justify-between">
          <span className="label">Today's homework</span>
          {completedToday && (
            <span className="text-correct text-xs uppercase tracking-wider">
              ✓ Drilled today
            </span>
          )}
        </header>
        <div className="flex items-end gap-3">
          <span className="font-mono text-6xl tabular-nums tracking-tight text-gold-dark">
            {dueCount}
          </span>
          <span className="text-text-secondary mb-2">
            blunder{dueCount === 1 ? '' : 's'} due
          </span>
          {tomorrowCount > 0 && (
            <div className="ml-auto self-end mb-1 px-3 py-2 rounded-none border-2 border-[#1A1A1A] bg-white text-sm">
              <span className="font-mono font-semibold tabular-nums text-gold-dark">
                {tomorrowCount}
              </span>{' '}
              <span className="text-text-secondary">
                position{tomorrowCount === 1 ? '' : 's'} due tomorrow
              </span>
            </div>
          )}
        </div>
        <DueByStage data={dueQuery.data ?? []} />
        <div className="flex gap-3">
          <button className="btn-primary" onClick={() => navigate('/training')}>
            Start training
          </button>
          {hasAccount && (
            <button
              className="btn-outline"
              disabled={isSyncing || !profile}
              onClick={() => profile && void triggerNow(profile)}
            >
              {isSyncing ? 'Syncing…' : 'Sync now'}
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="card flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <span className="label">Today's homework</span>
        {completedToday && (
          <span className="text-correct text-xs uppercase tracking-wider">
            ✓ Drilled today
          </span>
        )}
      </header>
      <div className="flex items-center gap-3">
        <span className="text-4xl text-gold-dark" aria-hidden>✓</span>
        <div>
          <p className="heading-md">All caught up</p>
          <p className="text-text-secondary text-sm">
            {hasAccount
              ? 'New drills will appear after your next sync.'
              : pgnOnly
                ? 'Upload more PGNs or connect an account to surface new drills.'
                : 'Sync your online account to get started, or upload your own PGNs to your vault.'}
          </p>
        </div>
      </div>
      <div className="flex gap-3">
        {hasAccount ? (
          <button
            className="btn-outline"
            disabled={isSyncing || !profile}
            onClick={() => profile && void triggerNow(profile)}
          >
            {isSyncing ? 'Syncing…' : 'Sync now'}
          </button>
        ) : pgnOnly ? (
          <button className="btn-primary" onClick={openUpload}>
            Upload PGNs
          </button>
        ) : (
          <>
            <button className="btn-primary" onClick={() => navigate('/profile')}>
              Connect account
            </button>
            <button className="btn-outline" onClick={openUpload}>
              Upload PGNs
            </button>
          </>
        )}
      </div>
    </section>
  );
}
