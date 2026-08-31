import clsx from 'clsx';
import { MOVE_GRADE_LABEL, MOVE_GRADE_TW_BG, MOVE_GRADES, type MoveGrade } from '../models/gameAnnotation';

export function ClassificationButtons({
  value,
  onChange,
  disabled,
}: {
  value: MoveGrade | null;
  onChange: (g: MoveGrade | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {MOVE_GRADES.map((g) => {
        const active = value === g;
        return (
          <button
            key={g}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(active ? null : g)}
            className={clsx(
              'flex flex-col items-center gap-1 py-2 rounded-none border-2 text-xs font-mono uppercase tracking-tight transition-colors disabled:opacity-50',
              active
                ? MOVE_GRADE_TW_BG[g]
                : 'bg-surface text-text-primary border-text-primary hover:bg-text-primary/5',
            )}
          >
            <span className="text-lg leading-none">{g}</span>
            <span className="text-[10px] opacity-80">{MOVE_GRADE_LABEL[g]}</span>
          </button>
        );
      })}
    </div>
  );
}
