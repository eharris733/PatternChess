import { HeartIcon } from './icons/HeartIcon';

export type SupporterBadge = 'supporter' | 'early';

export function supporterBadgeFromJson(v: unknown): SupporterBadge | null {
  return v === 'supporter' || v === 'early' ? v : null;
}

/** The heart next to a supporter's name on leaderboards (`supporter_badge()`, migration 20261124120000). */
export function SupporterMark({ badge, className }: { badge: SupporterBadge | null; className?: string }) {
  if (!badge) return null;
  return (
    <span data-testid="supporter-mark" className={className}>
      <HeartIcon className="h-3.5 w-3.5" title={badge === 'supporter' ? 'Supporter' : 'Early supporter'} />
    </span>
  );
}
