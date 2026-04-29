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
    <div className="grid grid-cols-4 gap-2">
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
              'flex flex-col items-center gap-1 py-2 rounded-md border text-xs font-bold uppercase tracking-wider transition disabled:opacity-50',
              active
                ? MOVE_GRADE_TW_BG[g]
                : 'bg-surface-2 text-text-secondary border-transparent hover:text-text-primary hover:border-surface-2',
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
