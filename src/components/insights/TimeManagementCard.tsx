import { useTimeManagementInsight } from '../../hooks/useInsights';

const MIN_TOTAL_PLIES = 50;

interface TileProps {
  label: string;
  userSec: number;
  gmSec: number | null;
  hasData: boolean;
}

function Tile({ label, userSec, gmSec, hasData }: TileProps) {
  return (
    <div className="flex flex-col items-start gap-1 bg-surface-2/60 rounded-md px-3 py-2">
      <span className="label text-[10px]">{label}</span>
      <span className="text-2xl font-bold tabular-nums text-text-primary">
        {hasData ? `${Math.round(userSec)}s` : '—'}
      </span>
      <span className="text-text-secondary text-xs tabular-nums">
        {gmSec != null ? `vs ${Math.round(gmSec)}s GM` : 'no benchmark'}
      </span>
    </div>
  );
}

export function TimeManagementCard() {
  const insight = useTimeManagementInsight();
  if (insight.isLoading || !insight.data) return null;
  const { samples, benchmark, benchmarkSource } = insight.data;

  const totalPlies = samples.reduce((acc, s) => acc + s.plyCount, 0);
  if (totalPlies < MIN_TOTAL_PLIES) return null;

  const open = samples.find((s) => s.phase === 'opening');
  const mid = samples.find((s) => s.phase === 'middlegame');
  const end = samples.find((s) => s.phase === 'endgame');

  return (
    <section className="card flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <span className="label">Time per move</span>
        <span className="text-text-secondary text-xs tabular-nums">
          {totalPlies.toLocaleString()} plies sampled
        </span>
      </header>
      <div className="grid grid-cols-3 gap-3">
        <Tile
          label="Opening"
          userSec={open?.averageSeconds ?? 0}
          gmSec={benchmark?.opening ?? null}
          hasData={(open?.plyCount ?? 0) > 0}
        />
        <Tile
          label="Middle"
          userSec={mid?.averageSeconds ?? 0}
          gmSec={benchmark?.middlegame ?? null}
          hasData={(mid?.plyCount ?? 0) > 0}
        />
        <Tile
          label="Endgame"
          userSec={end?.averageSeconds ?? 0}
          gmSec={benchmark?.endgame ?? null}
          hasData={(end?.plyCount ?? 0) > 0}
        />
      </div>
      {benchmarkSource && (
        <p className="text-text-secondary text-xs">{benchmarkSource}</p>
      )}
    </section>
  );
}
