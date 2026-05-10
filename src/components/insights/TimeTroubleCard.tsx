import { useNavigate } from 'react-router-dom';
import { useTimeTroubleInsight } from '../../hooks/useInsights';

const MIN_BLUNDERS_WITH_CLOCK = 20;

function pct(n: number, total: number): number {
  return total > 0 ? (n / total) * 100 : 0;
}

export function TimeTroubleCard() {
  const navigate = useNavigate();
  const insight = useTimeTroubleInsight();
  if (insight.isLoading || !insight.data) return null;
  const stats = insight.data;
  if (stats.total < MIN_BLUNDERS_WITH_CLOCK) return null;

  const sharePct = pct(stats.inTimeTrouble, stats.total);
  const totalTrouble = stats.inTimeTrouble;

  const phaseRow = (label: string, count: number) => (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-text-secondary">{label}</span>
      <span className="tabular-nums text-text-primary">
        {count} <span className="text-text-secondary">({Math.round(pct(count, totalTrouble))}%)</span>
      </span>
    </div>
  );

  return (
    <button
      type="button"
      onClick={() => navigate('/training', { state: { contextFilter: 'timeTrouble' } })}
      className="card flex flex-col gap-3 text-left hover:border-accent transition"
    >
      <header className="flex items-baseline justify-between">
        <span className="label">Time-trouble blunders</span>
        <span className="text-text-secondary text-xs tabular-nums">
          &lt;{stats.thresholdPercent}% time left
        </span>
      </header>
      <div className="flex items-end gap-3">
        <span className="text-5xl font-bold tabular-nums tracking-tight text-text-primary">
          {totalTrouble}
        </span>
        <span className="text-text-secondary mb-1 tabular-nums">
          {Math.round(sharePct)}% of timed blunders
        </span>
      </div>
      {totalTrouble > 0 && (
        <div className="flex flex-col gap-1.5">
          {phaseRow('Opening', stats.byPhase.opening)}
          {phaseRow('Middlegame', stats.byPhase.middlegame)}
          {phaseRow('Endgame', stats.byPhase.endgame)}
        </div>
      )}
      {stats.excludedBlunders > 0 && (
        <p className="text-text-secondary text-xs">
          {stats.excludedBlunders.toLocaleString()} blunder
          {stats.excludedBlunders === 1 ? '' : 's'} excluded — no clock data on those games.
        </p>
      )}
      <span className="text-accent-light text-xs uppercase tracking-wider">
        Drill these →
      </span>
    </button>
  );
}
