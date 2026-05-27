import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import { usePhaseBlunderInsight } from '../../hooks/useInsights';
import { InsightCardSkeleton } from '../Skeleton';
import type { BlunderPhase } from '../../models/blunder';

const MIN_BLUNDERS = 30;

interface BarProps {
  label: string;
  userPct: number;
  benchmarkPct: number | null;
  benchmarkSampleSize: number | null;
  onClick?: () => void;
}

function Bar({ label, userPct, benchmarkPct, benchmarkSampleSize, onClick }: BarProps) {
  const inner = (
    <>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-text-secondary">{label}</span>
        <span className="tabular-nums text-text-primary">{Math.round(userPct)}%</span>
      </div>
      <div className="relative h-3 rounded-none bg-[#1A1A1A]/10 overflow-visible border border-[#1A1A1A]/20">
        <div
          className="absolute inset-y-0 left-0 rounded-none bg-gold-dark"
          style={{ width: `${Math.min(100, userPct)}%` }}
        />
        {benchmarkPct !== null && (
          <span
            className="absolute -top-0.5 h-4 w-0.5 bg-[#1A1A1A]"
            style={{ left: `${Math.min(100, benchmarkPct)}%` }}
            title={
              benchmarkSampleSize
                ? `Benchmark: ${benchmarkPct.toFixed(1)}% (n=${benchmarkSampleSize.toLocaleString()})`
                : `Benchmark: ${benchmarkPct.toFixed(1)}%`
            }
          />
        )}
      </div>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex flex-col gap-1.5 text-left w-full rounded-none transition-opacity hover:opacity-75"
      >
        {inner}
      </button>
    );
  }
  return <div className="flex flex-col gap-1.5">{inner}</div>;
}

export function PhaseBlunderCard() {
  const navigate = useNavigate();
  const insight = usePhaseBlunderInsight();
  if (insight.isPending) return <InsightCardSkeleton rows={3} />;
  if (!insight.data) return null;
  const { counts, benchmark, band, benchmarkSampleSize, benchmarkSource } = insight.data;
  if (counts.total < MIN_BLUNDERS) return null;

  const openingPct = (counts.opening / counts.total) * 100;
  const middlePct = (counts.middlegame / counts.total) * 100;
  const endPct = (counts.endgame / counts.total) * 100;

  // Benchmark expresses absolute blunder *rate* (per-move). Normalize to a
  // distribution share so it sits on the same axis as the user's bars.
  let benchmarkShare: { opening: number; middlegame: number; endgame: number } | null = null;
  if (benchmark) {
    const total = benchmark.opening + benchmark.middlegame + benchmark.endgame;
    if (total > 0) {
      benchmarkShare = {
        opening: (benchmark.opening / total) * 100,
        middlegame: (benchmark.middlegame / total) * 100,
        endgame: (benchmark.endgame / total) * 100,
      };
    }
  }

  const drill = (phase: BlunderPhase) => navigate('/training', { state: { phaseFilter: phase } });

  return (
    <section className={clsx('card flex flex-col gap-4')}>
      <header className="flex items-baseline justify-between">
        <span className="label">Where you blunder</span>
        <span className="text-text-secondary text-xs tabular-nums">
          {counts.total.toLocaleString()} total
        </span>
      </header>
      <div className="flex flex-col gap-3">
        <Bar
          label="Opening"
          userPct={openingPct}
          benchmarkPct={benchmarkShare?.opening ?? null}
          benchmarkSampleSize={benchmarkSampleSize}
          onClick={counts.opening > 0 ? () => drill('opening') : undefined}
        />
        <Bar
          label="Middlegame"
          userPct={middlePct}
          benchmarkPct={benchmarkShare?.middlegame ?? null}
          benchmarkSampleSize={benchmarkSampleSize}
          onClick={counts.middlegame > 0 ? () => drill('middlegame') : undefined}
        />
        <Bar
          label="Endgame"
          userPct={endPct}
          benchmarkPct={benchmarkShare?.endgame ?? null}
          benchmarkSampleSize={benchmarkSampleSize}
          onClick={counts.endgame > 0 ? () => drill('endgame') : undefined}
        />
      </div>
      <p className="font-mono uppercase text-[10px] tracking-tight text-gold-dark">
        Select a phase to drill those blunders →
      </p>
      {benchmarkShare && benchmarkSource && (
        <p className="text-text-secondary text-xs">
          Tick = same-rating peer share ({band}). {benchmarkSource}
        </p>
      )}
    </section>
  );
}
