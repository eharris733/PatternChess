import type { ReactNode } from 'react';
import clsx from 'clsx';

interface SettingToggleCardProps {
  title: string;
  description: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** A small picture of the setting's effect (TrainingPrefPreviews), drawn for the current value. */
  preview?: ReactNode;
  testId?: string;
}

/** One /profile setting: a preview of its effect, a short description, and a switch (a styled checkbox). */
export function SettingToggleCard({ title, description, checked, onChange, preview, testId }: SettingToggleCardProps) {
  return (
    <label
      className={clsx(
        'flex cursor-pointer select-none flex-col gap-2 border-2 bg-surface p-3 transition-colors',
        checked ? 'border-text-primary' : 'border-text-primary/25 hover:border-text-primary/60',
      )}
      data-testid={testId}
    >
      {preview && <div className="border border-text-primary/20">{preview}</div>}
      <span className="flex items-start justify-between gap-3">
        <span className="font-semibold text-text-primary">{title}</span>
        <input
          type="checkbox"
          className={clsx(
            'relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer appearance-none border-2 border-text-primary bg-surface-3 transition-colors',
            'checked:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            "before:absolute before:left-0.5 before:top-0.5 before:h-3 before:w-3 before:bg-text-primary before:transition-transform before:content-['']",
            'checked:before:translate-x-4',
          )}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
      </span>
      <span className="text-sm text-text-primary">{description}</span>
    </label>
  );
}
