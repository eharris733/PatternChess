import clsx from 'clsx';
import type { OpeningDrillSource, TheoryMove } from '../../models/blunder';
import { CASTLING_NORMALIZE } from '../../chess/moveUtils';
import { bookPlayersLabel, type BookTier } from '../../chess/bookFormat';

/** "Players rated 2200+ (OTB) play" — v1 drills without a tier fall back. */
export function playersHeading(tier: BookTier | null | undefined): string {
  if (!tier) return 'Strong players play';
  const label = bookPlayersLabel(tier);
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} play`;
}

function sameUci(a: string, b: string): boolean {
  return (CASTLING_NORMALIZE[a] ?? a) === (CASTLING_NORMALIZE[b] ?? b);
}

/**
 * What to play instead, for opening feedback (drill verdicts, /openings
 * cards, the review screen). Book answers: a bar chart of what strong
 * players chose here (share of the position's games), the user's move
 * highlighted. Engine answers (a mistake after the book ran out): the
 * engine's move first, then any other sound options.
 */
export function TheoryMovesLine({
  moves,
  source,
  max = 3,
  highlightUci,
}: {
  moves: TheoryMove[];
  source: OpeningDrillSource;
  max?: number;
  /** The move the user played, when it is one of these (drawn green). */
  highlightUci?: string | null;
}) {
  const shown = moves.slice(0, max);
  if (shown.length === 0) return null;

  if (source === 'engine') {
    const engine = shown.find((t) => t.engineBest) ?? shown[0];
    const others = shown.filter((t) => t !== engine);
    return (
      <p className="text-text-primary text-sm" data-testid="theory-moves-line">
        <span className="font-semibold">Best: </span>
        <span className="font-mono font-semibold">{engine.san}</span>
        {others.length > 0 && (
          <>
            {' · also fine: '}
            <span className="font-mono">{others.map((t) => t.san).join(', ')}</span>
          </>
        )}
      </p>
    );
  }

  return (
    <figure className="flex flex-col gap-1.5" data-testid="theory-moves-line">
      <figcaption className="label text-text-primary">{playersHeading(shown[0]?.tier)}</figcaption>
      <ul className="flex flex-col gap-1">
        {shown.map((t) => {
          const mine = !!highlightUci && sameUci(t.uci, highlightUci);
          const pct = t.games > 0 ? Math.round(t.share) : null;
          return (
            <li key={t.uci} className="grid grid-cols-[3.25rem_1fr_2.5rem] items-center gap-2">
              <span className={clsx('font-mono text-sm font-semibold', mine ? 'text-correct' : 'text-text-primary')}>
                {t.san}
              </span>
              <span className="h-3 border border-text-primary/40 bg-text-primary/5">
                {pct != null && (
                  <span
                    className={clsx('block h-full', mine ? 'bg-correct' : 'bg-gold-dark')}
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                )}
              </span>
              <span className="text-right font-mono text-xs tabular-nums text-text-primary">
                {pct != null ? `${pct}%` : '—'}
              </span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
