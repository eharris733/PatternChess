import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import { MOVE_GRADE_TW_BG, type MoveGrade } from '../models/gameAnnotation';

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
      className={clsx('font-mono text-[13px] divide-y divide-[#1A1A1A]/15', className)}
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
        'flex items-center gap-1.5 rounded-none px-1.5 py-0.5 text-left transition-colors hover:bg-[#1A1A1A]/5 flex-wrap',
        active && 'bg-[#1A1A1A] text-[#F4F4F0]',
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
        <span className="px-1 rounded-none text-[9px] font-bold uppercase bg-surface-3 text-text-secondary border border-[#1A1A1A]/40">
          {move.tag}
        </span>
      )}
      {move.contextTags?.map((t) => (
        <span
          key={t}
          className="px-1 rounded-none text-[9px] font-bold uppercase bg-surface-3 text-text-secondary border border-[#1A1A1A]/40"
        >
          {t}
        </span>
      ))}
    </button>
  );
}
