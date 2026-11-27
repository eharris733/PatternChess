import clsx from 'clsx';
import { PlatformLogo, PLATFORM_NAME } from './icons/PlatformLogos';
import type { PlayTarget } from '../hooks/useDailyPlan';
import { useT } from '../i18n/useT';

/**
 * One "play" link per linked site, for players who sync from both Lichess and
 * Chess.com: games on either count toward the plan's Play step, so the choice
 * is theirs. Logo only on phones, logo + name from `sm` up.
 */
export function PlayLinks({
  targets,
  primary,
  testId,
}: {
  targets: PlayTarget[];
  primary?: boolean;
  testId?: string;
}) {
  const t = useT();
  return (
    <span className="flex shrink-0 gap-1.5" data-testid={testId}>
      {targets.map((l) => (
        <a
          key={l.platform}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('plan.play.on', { site: PLATFORM_NAME[l.platform] })}
          data-platform={l.platform}
          className={clsx(
            primary ? 'btn-primary' : 'btn-outline',
            'h-9 px-2.5 sm:px-3 text-xs whitespace-nowrap gap-1.5',
          )}
        >
          <PlatformLogo platform={l.platform} className="h-4 w-4" mono={primary} />
          <span className="hidden sm:inline">{PLATFORM_NAME[l.platform]}</span>
        </a>
      ))}
    </span>
  );
}
