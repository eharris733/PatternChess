import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBlunderStats } from '../../hooks/useBlunderStats';
import { totalEloGained, useRatingProgress } from '../../hooks/useRatingProgress';
import { useCountUp } from '../../hooks/useCountUp';
import { rankFor } from '../../lib/ranks';
import { Skeleton } from '../Skeleton';
import { TrendChip } from './TrendChip';

function StatTile({
  label,
  value,
  format,
  chip,
  footer,
  onClick,
  loading,
}: {
  label: string;
  value: number;
  /** Formats the animated integer (e.g. "+120" for a rating delta). */
  format?: (n: number) => string;
  chip?: string | null;
  /** Extra content under the number (the rank ladder on the mastery tile). */
  footer?: ReactNode;
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
      {!loading && footer}
    </button>
  );
}

/**
 * The Pawn → Knight → Bishop … ladder from `lib/ranks`: current tier, a
 * progress bar through it, and how many more mastered positions reach the
 * next piece. Lives under the mastered count so the number has a goal.
 */
function RankLadder({ mastered }: { mastered: number }) {
  const progress = rankFor(mastered);
  const pct = Math.min(100, Math.round(progress.fraction * 100));
  return (
    <span className="mt-2 flex w-full flex-col gap-1" data-testid="rank-ladder">
      <span className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="font-mono uppercase text-xs tracking-tight text-text-primary">
          {progress.current.name}
        </span>
        <span className="text-[11px] text-text-secondary tabular-nums">
          {progress.next ? `${progress.remainingToNext} to ${progress.next.name}` : 'Top tier'}
        </span>
      </span>
      <span
        className="block h-1.5 w-full overflow-hidden border border-text-primary/20 bg-text-primary/10"
        role="progressbar"
        aria-label={
          progress.next
            ? `${progress.current.name}: ${progress.remainingToNext} more mastered until ${progress.next.name}`
            : `${progress.current.name}: top tier reached`
        }
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span
          className="block h-full bg-gold-dark transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  );
}

const formatSigned = (n: number) => (n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString());

/**
 * The numbers that go up: mastered positions (with the piece-rank ladder),
 * positions solved, and rating gained since joining. Sits at the top of the
 * dashboard for returning users. (The streak lives in the sidebar badge and
 * on the profile — not here.)
 */
export function StatStrip() {
  const navigate = useNavigate();
  const stats = useBlunderStats();
  const rating = useRatingProgress();

  // Animate once per mount, after the first paint, so the count-up is seen.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const mastered = stats.data?.mastered ?? 0;
  const masteredRecently = stats.data?.masteredRecently ?? 0;
  // Sum of times_correct — every position solved, first attempt or repeat.
  const solved = stats.data?.reviewed ?? 0;
  const eloGained = totalEloGained(rating.progress);

  const showRatingProgress = () => {
    const card = document.getElementById('rating-progress');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else navigate('/profile');
  };

  return (
    <div className="grid grid-cols-3 gap-3" aria-label="Your numbers">
      <StatTile
        label="Mastered"
        value={mastered}
        chip={masteredRecently > 0 ? `+${masteredRecently} this week` : null}
        footer={<RankLadder mastered={mastered} />}
        onClick={() => navigate('/achievements')}
        loading={!mounted || stats.isPending}
      />
      <StatTile
        label="Positions solved"
        value={solved}
        onClick={() => navigate('/training')}
        loading={!mounted || stats.isPending}
      />
      <StatTile
        label="Elo gained"
        value={eloGained}
        format={formatSigned}
        onClick={showRatingProgress}
        loading={!mounted || rating.isPending}
      />
    </div>
  );
}
