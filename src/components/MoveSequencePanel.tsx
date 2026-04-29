import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import { MOVE_GRADE_TW_BG, type MoveGrade } from '../models/gameAnnotation';

export interface MovePair {
  /** Full-move number (1, 2, 3, …) */
  moveNumber: number;
  white?: { san: string; key: string; grade?: MoveGrade | null; tag?: string };
  black?: { san: string; key: string; grade?: MoveGrade | null; tag?: string };
}

export function MoveSequencePanel({
  pairs,
  activeKey,
  onSelect,
  className,
}: {
  pairs: MovePair[];
  activeKey?: string | null;
  onSelect?: (key: string) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeKey || !containerRef.current) return;
    const el = containerRef.current.querySelector<HTMLElement>(`[data-key="${activeKey}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeKey]);

  return (
    <div
      ref={containerRef}
      className={clsx('font-mono text-[13px] divide-y divide-surface-2', className)}
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
  );
}

function Cell({
  move,
  active,
  onSelect,
}: {
  move: MovePair['white'];
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
        'flex items-center gap-1.5 rounded px-1.5 py-0.5 text-left transition hover:bg-surface-2',
        active && 'bg-accent/15 text-accent-light',
      )}
    >
      <span>{move.san}</span>
      {move.grade && (
        <span
          className={clsx(
            'px-1 rounded text-[9px] font-bold uppercase border',
            MOVE_GRADE_TW_BG[move.grade],
          )}
        >
          {move.grade}
        </span>
      )}
      {move.tag && (
        <span className="px-1 rounded text-[9px] font-bold uppercase bg-surface-2 text-text-secondary border border-surface-2">
          {move.tag}
        </span>
      )}
    </button>
  );
}
