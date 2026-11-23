import type { TimeControlCategory } from '../services/chessApiService';
import { useT } from '../i18n/useT';
import type { MessageKey } from '../i18n/i18n';

export const TIME_CONTROL_OPTIONS: { value: TimeControlCategory; label: string; labelKey: MessageKey }[] = [
  { value: 'bullet', label: 'Bullet', labelKey: 'gameType.bullet' },
  { value: 'blitz', label: 'Blitz', labelKey: 'gameType.blitz' },
  { value: 'rapid', label: 'Rapid', labelKey: 'gameType.rapid' },
  { value: 'classical', label: 'Classical', labelKey: 'gameType.classical' },
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
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 select-none">
        <input
          type="checkbox"
          checked={ratedOnly}
          onChange={(e) => onRatedOnlyChange(e.target.checked)}
        />
        <span>{t('gameType.ratedOnly')}</span>
      </label>
      <div className="flex flex-col gap-2">
        <label className="label">{t('gameType.timeControls')}</label>
        <p className="text-text-primary text-xs -mt-1">
          {t('gameType.timeControlsHelp')}
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
              <span>{t(opt.labelKey)}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
