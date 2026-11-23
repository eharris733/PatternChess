import { useState } from 'react';
import { useQuotaGuard } from '../../hooks/useDailyQuota';
import { useNavigate } from 'react-router-dom';
import { MOTIF_LABEL, type Motif } from '../../chess/motifs';
import { useMotifInsight } from '../../hooks/useInsights';
import { InsightCardSkeleton } from '../Skeleton';

/** Enough tagged rows for the distribution to mean something. */
const MIN_TAGGED = 10;
const TOP_N = 5;

/**
 * "Recurring weaknesses": the most frequent tactical motifs across the user's
 * tagged blunders, each drillable via the training motif filter. Mirrors
 * PhaseBlunderCard's shape; motif tags come from the analysis-time detector
 * (src/chess/motifs.ts) and the enrichment backfill for older rows.
 */
export function MotifWeaknessCard() {
  const navigate = useNavigate();
  const { guard } = useQuotaGuard();
  const insight = useMotifInsight();
  const [showAll, setShowAll] = useState(false);
  if (insight.isPending) return <InsightCardSkeleton rows={3} />;
  if (!insight.data) return null;
  const { counts, tagged, untagged } = insight.data;
  if (tagged < MIN_TAGGED) return null;

  const all = (Object.entries(counts) as Array<[Motif, number]>)
    .filter(([m]) => m in MOTIF_LABEL)
    .sort((a, b) => b[1] - a[1]);
  if (all.length === 0) return null;
  const top = showAll ? all : all.slice(0, TOP_N);
  const maxCount = all[0][1];

  const drill = (motif: Motif) => guard('positions') && navigate('/training', { state: { motifFilter: motif } });

  return (
    <section className="card flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <span className="label">Recurring weaknesses</span>
        <span className="font-mono text-text-primary text-xs tabular-nums">
          {tagged.toLocaleString()} tagged
        </span>
      </header>
      <div className="flex flex-col gap-3">
        {top.map(([motif, count]) => (
          <button
            key={motif}
            type="button"
            onClick={() => drill(motif)}
            className="flex flex-col gap-1.5 text-left w-full rounded-none transition-opacity hover:opacity-75"
          >
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-text-primary">{MOTIF_LABEL[motif]}</span>
              <span className="tabular-nums text-text-primary">{count}</span>
            </div>
            <div className="relative h-3 rounded-none bg-text-primary/10 border border-text-primary/20">
              <div
                className="absolute inset-y-0 left-0 rounded-none bg-gold-dark"
                style={{ width: `${Math.min(100, (count / maxCount) * 100)}%` }}
              />
            </div>
          </button>
        ))}
      </div>
      {all.length > TOP_N && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="self-start text-xs font-semibold text-text-primary underline underline-offset-2"
        >
          {showAll ? 'Show fewer' : `Show all ${all.length}`}
        </button>
      )}
      <p className="text-xs text-text-primary">Tap a weakness to drill it.</p>
    </section>
  );
}
