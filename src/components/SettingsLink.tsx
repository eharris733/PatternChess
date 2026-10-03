import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { GearIcon } from './icons/GearIcon';

/** Where the gear goes: the settings block on /profile. */
export const SETTINGS_HREF = '/profile#settings';

/** Gear button that jumps to the profile's settings section. */
export function SettingsLink({ className, onClick }: { className?: string; onClick?: () => void }) {
  return (
    <Link
      to={SETTINGS_HREF}
      onClick={onClick}
      aria-label="Settings"
      title="Settings"
      data-testid="settings-link"
      className={clsx(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center border-2 border-text-primary/20 text-text-primary transition-colors hover:border-accent',
        className,
      )}
    >
      <GearIcon className="h-5 w-5" />
    </Link>
  );
}
