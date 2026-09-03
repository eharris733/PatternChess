import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { useBlunderStats } from '../../hooks/useBlunderStats';
import { useDueBlunders } from '../../hooks/useDueBlunders';
import { useEndgameScenarios } from '../../hooks/useEndgameScenarios';
import { useWeeklyActivity } from '../../hooks/useTrainingActivity';
import { useCountUp } from '../../hooks/useCountUp';
import { droppedHalfPoints, formatHalfPoints } from '../../lib/halfPoints';
import { FlameIcon } from '../icons/FlameIcon';
import { TrendUpIcon } from '../icons/TrendUpIcon';
import { Skeleton } from '../Skeleton';

/**
 * Green "+N this week" chip. Rendered only for a positive delta — the strip
 * exists to make good trends visible, so zero and negative stay silent.
 */
function TrendChip({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-correct/50 bg-correct/10 text-correct font-mono text-[10px] uppercase tracking-tight">
      <TrendUpIcon className="h-3 w-3" />
      {children}
    </span>
  );
}

function StatTile({
  label,
  value,
  format,
  chip,
  icon,
  onClick,
  loading,
}: {
  label: string;
  value: number;
  /** Formats the animated integer (e.g. half-points → "3½"). */
  format?: (n: number) => string;
  chip?: string | null;
  icon?: React.ReactNode;
  onClick?: () => void;
  loading: boolean;
}) {
  const shown = useCountUp(value, !loading, 1200);
  const text = format ? format(shown) : shown.toLocaleString();
  const body = (
    <>
      <span className="label">{label}</span>
      {loading ? (
        <Skeleton className="h-8 w-16 mt-1" />
      ) : (
        <span className="flex items-baseline gap-1.5 mt-1">
          {icon}
          <span className="font-mono text-3xl tracking-tight text-gold-dark">{text}</span>
        </span>
      )}
      <span className="mt-1 h-4">{!loading && chip ? <TrendChip>{chip}</TrendChip> : null}</span>
    </>
  );
  const className = 'card flex flex-col items-start gap-0 px-4 py-3 text-left';
  return onClick ? (
    <button type="button" className={`${className} hover:border-accent transition`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * The numbers that go up: streak, mastered positions, due today, half-points
 * rescued in endgames. Sits at the top of the dashboard for returning users.
 */
export function StatStrip() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const stats = useBlunderStats();
  const due = useDueBlunders();
  const scenarios = useEndgameScenarios();
  const weekly = useWeeklyActivity();

  // Animate once per mount, after the first paint, so the count-up is seen.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const streak = profile?.currentStreakDays ?? 0;
  const mastered = stats.data?.mastered ?? 0;
  const masteredRecently = stats.data?.masteredRecently ?? 0;
  const dueCount = due.data?.length ?? 0;
  const rescuedHalf = (scenarios.data ?? [])
    .filter((s) => s.status === 'passed')
    .reduce((sum, s) => sum + droppedHalfPoints(s), 0);
  const drilledThisWeek = weekly.data?.attempted ?? 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Your numbers">
      <StatTile
        label="Day streak"
        value={streak}
        icon={<FlameIcon className="h-5 w-5 self-center" />}
        chip={drilledThisWeek > 0 ? `${drilledThisWeek} drilled this week` : null}
        loading={!mounted || weekly.isPending}
      />
      <StatTile
        label="Mastered"
        value={mastered}
        chip={masteredRecently > 0 ? `+${masteredRecently} this week` : null}
        onClick={() => navigate('/achievements')}
        loading={!mounted || stats.isPending}
      />
      <StatTile
        label="Due today"
        value={dueCount}
        onClick={() => navigate('/training')}
        loading={!mounted || due.isPending}
      />
      <StatTile
        label="Points rescued"
        value={rescuedHalf}
        format={formatHalfPoints}
        onClick={() => navigate('/endgames')}
        loading={!mounted || (scenarios.isPending && scenarios.isFetching)}
      />
    </div>
  );
}
