import { useNavigate } from 'react-router-dom';
import { useQuotaGuard } from '../../hooks/useDailyQuota';
import { useTimeManagementInsight } from '../../hooks/useInsights';
import { InsightCardSkeleton } from '../Skeleton';

const MIN_TOTAL_PLIES = 50;

interface TileProps {
  label: string;
  userSec: number;
  hasData: boolean;
}

function Tile({ label, userSec, hasData }: TileProps) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1 bg-surface-3 rounded-none border-2 border-text-primary px-2 sm:px-3 py-2">
      <span className="label">{label}</span>
      <span className="font-mono text-2xl tabular-nums text-gold-dark">
        {hasData ? `${Math.round(userSec)}s` : '—'}
      </span>
      <span className="text-text-primary text-xs">per move</span>
    </div>
  );
}

export function TimeManagementCard() {
  const navigate = useNavigate();
  const { guard } = useQuotaGuard();
  const insight = useTimeManagementInsight();
  if (insight.isPending) return <InsightCardSkeleton rows={2} />;
  if (!insight.data) return null;
  const { samples } = insight.data;

  const totalPlies = samples.reduce((acc, s) => acc + s.plyCount, 0);
  if (totalPlies < MIN_TOTAL_PLIES) return null;

  const open = samples.find((s) => s.phase === 'opening');
  const mid = samples.find((s) => s.phase === 'middlegame');
  const end = samples.find((s) => s.phase === 'endgame');

  return (
    <section className="card flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <span className="label">Time per move</span>
        <span className="font-mono text-text-primary text-xs tabular-nums">
          {totalPlies.toLocaleString()} moves
        </span>
      </header>
      <p className="text-text-primary text-xs -mt-1">Average think time in your non-bullet games, by phase.</p>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Tile
          label="Opening"
          userSec={open?.averageSeconds ?? 0}
          hasData={(open?.plyCount ?? 0) > 0}
        />
        <Tile
          label="Middle"
          userSec={mid?.averageSeconds ?? 0}
          hasData={(mid?.plyCount ?? 0) > 0}
        />
        <Tile
          label="Endgame"
          userSec={end?.averageSeconds ?? 0}
          hasData={(end?.plyCount ?? 0) > 0}
        />
      </div>
      <button
        type="button"
        onClick={() => guard('positions') && navigate('/training', { state: { contextFilter: 'longThink' } })}
        className="self-start text-sm font-semibold text-gold-dark underline underline-offset-2 hover:text-text-primary transition-colors"
      >
        Drill long-think blunders
      </button>
    </section>
  );
}
