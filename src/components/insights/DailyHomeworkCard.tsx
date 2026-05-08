import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { useDueBlunders } from '../../hooks/useDueBlunders';
import { useCompletedToday } from '../../hooks/useTrainingActivity';
import { useSyncStore } from '../../state/syncStore';

export function DailyHomeworkCard() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const dueQuery = useDueBlunders();
  const completedTodayQuery = useCompletedToday();
  const triggerNow = useSyncStore((s) => s.triggerNow);
  const isSyncing = useSyncStore((s) => {
    const busy = (phase: string) =>
      phase === 'fetching' || phase === 'inserting' || phase === 'analyzing';
    return busy(s.providers.lichess.phase) || busy(s.providers.chesscom.phase);
  });

  const dueCount = dueQuery.data?.length ?? 0;
  const completedToday = completedTodayQuery.data === true;
  const hasAccount = !!(profile?.lichessUsername || profile?.chesscomUsername);

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
          <span className="text-6xl font-bold tabular-nums tracking-tight text-text-primary">
            {dueCount}
          </span>
          <span className="text-text-secondary mb-2">
            blunder{dueCount === 1 ? '' : 's'} due
          </span>
        </div>
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
        <span className="text-4xl" aria-hidden>✓</span>
        <div>
          <p className="text-text-primary heading-md">All caught up</p>
          <p className="text-text-secondary text-sm">
            {hasAccount
              ? 'New drills will appear after your next sync.'
              : 'Link an account to import games and surface new drills.'}
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
        ) : (
          <button className="btn-primary" onClick={() => navigate('/profile')}>
            Add account
          </button>
        )}
      </div>
    </section>
  );
}
