import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import { MOVE_GRADE_TW_BG, type MoveGrade } from '../models/gameAnnotation';
import { ChevronIcon } from './icons/ChevronIcon';

export interface MoveCell {
  san: string;
  key: string;
  grade?: MoveGrade | null;
  tag?: string;
  contextTags?: string[];
}

export interface MovePair {
  /** Full-move number (1, 2, 3, …) */
  moveNumber: number;
  white?: MoveCell;
  black?: MoveCell;
}

export function MoveSequencePanel({
  pairs,
  activeKey,
  onSelect,
  onStep,
  stepArrowsDesktopOnly,
  className,
}: {
  pairs: MovePair[];
  activeKey?: string | null;
  onSelect?: (key: string) => void;
  /** Render prev/next arrows that step through the line (tap equivalent of ←/→). */
  onStep?: (dir: 1 | -1) => void;
  /** Hide the arrow footer below lg (for screens that surface arrows near the board instead). */
  stepArrowsDesktopOnly?: boolean;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!activeKey || !container) return;
    const el = container.querySelector<HTMLElement>(`[data-key="${activeKey}"]`);
    if (!el) return;
    // Scroll *only* the panel's own scroll area to reveal the active move —
    // never scrollIntoView, which would walk up to the page scroll container
    // and drag the board out of view on narrow screens.
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    if (eRect.top < cRect.top) {
      container.scrollTop -= cRect.top - eRect.top;
    } else if (eRect.bottom > cRect.bottom) {
      container.scrollTop += eRect.bottom - cRect.bottom;
    }
  }, [activeKey]);

  return (
    <div className={className}>
      <div
        ref={containerRef}
        className="font-mono text-[13px] divide-y divide-text-primary/15 max-h-[45vh] overflow-y-auto"
      >
        {pairs.map((p) => (
          <div
            key={p.moveNumber}
            className="grid grid-cols-[36px_1fr_1fr] gap-2 py-1.5 px-2 items-center"
          >
            <span className="text-text-secondary text-right pr-1 select-none">{p.moveNumber}.</span>
            <Cell move={p.white} active={activeKey === p.white?.key} onSelect={onSelect} />
            <Cell move={p.black} active={activeKey === p.black?.key} onSelect={onSelect} />
          </div>
        ))}
      </div>
      {onStep && (
        <div
          className={clsx(
            'items-center justify-end gap-1 border-t border-text-primary/15 py-0.5 px-1',
            stepArrowsDesktopOnly ? 'hidden lg:flex' : 'flex',
          )}
        >
          <button
            type="button"
            aria-label="Previous move"
            onClick={() => onStep(-1)}
            className="h-8 w-10 flex items-center justify-center text-text-primary hover:bg-accent/10 transition-colors"
          >
            <ChevronIcon className="h-4 w-4 rotate-180" />
          </button>
          <button
            type="button"
            aria-label="Next move"
            onClick={() => onStep(1)}
            className="h-8 w-10 flex items-center justify-center text-text-primary hover:bg-accent/10 transition-colors"
          >
            <ChevronIcon className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

const TAG_TONE = 'bg-surface-3 text-text-secondary border-text-primary/40';

function Cell({
  move,
  active,
  onSelect,
}: {
  move: MoveCell | undefined;
  active: boolean;
  onSelect?: (key: string) => void;
}) {
  if (!move) return <span />;
  return (
    <button
      type="button"
      data-key={move.key}
      onClick={() => onSelect?.(move.key)}
      className={clsx(
        'flex items-center gap-1.5 rounded-none px-1.5 py-0.5 text-left transition-colors hover:bg-accent/10 flex-wrap',
        active && 'bg-accent/15 ring-1 ring-inset ring-accent',
      )}
    >
      <span>{move.san}</span>
      {move.grade && (
        <span
          className={clsx(
            'px-1 rounded-none text-[9px] font-bold uppercase border',
            MOVE_GRADE_TW_BG[move.grade],
          )}
        >
          {move.grade}
        </span>
      )}
      {move.tag && (
        <span className={clsx('px-1 rounded-none text-[9px] font-bold uppercase border', TAG_TONE)}>
          {move.tag}
        </span>
      )}
      {move.contextTags?.map((t) => (
        <span
          key={t}
          className={clsx('px-1 rounded-none text-[9px] font-bold uppercase border', TAG_TONE)}
        >
          {t}
        </span>
      ))}
    </button>
  );
}
