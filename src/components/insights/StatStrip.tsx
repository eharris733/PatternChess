import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBlunderStats } from '../../hooks/useBlunderStats';
import { useDueBlunders } from '../../hooks/useDueBlunders';
import { useEndgameScenarios } from '../../hooks/useEndgameScenarios';
import { useCountUp } from '../../hooks/useCountUp';
import { droppedHalfPoints, formatHalfPoints } from '../../lib/halfPoints';
import { Skeleton } from '../Skeleton';
import { TrendChip } from './TrendChip';

function StatTile({
  label,
  value,
  format,
  chip,
  onClick,
  loading,
}: {
  label: string;
  value: number;
  /** Formats the animated integer (e.g. half-points → "3½"). */
  format?: (n: number) => string;
  chip?: string | null;
  onClick: () => void;
  loading: boolean;
}) {
  const shown = useCountUp(value, !loading, 1200);
  const text = format ? format(shown) : shown.toLocaleString();
  return (
    <button
      type="button"
      className="card flex flex-col items-start gap-0 px-4 py-3 text-left hover:border-accent transition"
      onClick={onClick}
    >
      <span className="label">{label}</span>
      {loading ? (
        <Skeleton className="h-8 w-16 mt-1" />
      ) : (
        <span className="font-mono text-3xl tracking-tight text-gold-dark mt-1">{text}</span>
      )}
      {!loading && chip && (
        <span className="mt-1">
          <TrendChip>{chip}</TrendChip>
        </span>
      )}
    </button>
  );
}

/**
 * The numbers that go up: mastered positions, due today, half-points rescued
 * in endgames. Sits at the top of the dashboard for returning users. (The
 * streak lives in the sidebar badge and on the profile — not here.)
 */
export function StatStrip() {
  const navigate = useNavigate();
  const stats = useBlunderStats();
  const due = useDueBlunders();
  const scenarios = useEndgameScenarios();

  // Animate once per mount, after the first paint, so the count-up is seen.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const mastered = stats.data?.mastered ?? 0;
  const masteredRecently = stats.data?.masteredRecently ?? 0;
  const dueCount = due.data?.length ?? 0;
  const rescuedHalf = (scenarios.data ?? [])
    .filter((s) => s.status === 'passed')
    .reduce((sum, s) => sum + droppedHalfPoints(s), 0);

  return (
    <div className="grid grid-cols-3 gap-3" aria-label="Your numbers">
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
