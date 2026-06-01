import type { TimeControlCategory } from '../services/chessApiService';

export const TIME_CONTROL_OPTIONS: { value: TimeControlCategory; label: string }[] = [
  { value: 'bullet', label: 'Bullet' },
  { value: 'blitz', label: 'Blitz' },
  { value: 'rapid', label: 'Rapid' },
  { value: 'classical', label: 'Classical' },
];

/**
 * Shared editor for the "which games count for training" preferences
 * (`preferredRatedOnly` + `preferredTimeControls`). Used by both the profile
 * page and the new-user onboarding flow so the two stay in sync.
 */
export function GameTypePreferences({
  ratedOnly,
  onRatedOnlyChange,
  timeControls,
  onToggleTimeControl,
}: {
  ratedOnly: boolean;
  onRatedOnlyChange: (value: boolean) => void;
  timeControls: TimeControlCategory[];
  onToggleTimeControl: (value: TimeControlCategory) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 select-none">
        <input
          type="checkbox"
          checked={ratedOnly}
          onChange={(e) => onRatedOnlyChange(e.target.checked)}
        />
        <span>Rated games only</span>
      </label>
      <div className="flex flex-col gap-2">
        <label className="label">Time controls</label>
        <p className="text-text-secondary text-xs -mt-1">
          Leave all unchecked to include every time control.
        </p>
        <div className="flex flex-wrap gap-3">
          {TIME_CONTROL_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2 select-none px-3 py-1.5 rounded-none bg-surface border-2 border-text-primary hover:bg-text-primary/5 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={timeControls.includes(opt.value)}
                onChange={() => onToggleTimeControl(opt.value)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
