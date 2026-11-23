import { openDailyLimit } from '../../state/supporterUnlockStore';
import type { QuotaKind } from '../../lib/dailyLimit';
import { DailyLimitCountdown } from './DailyLimitCountdown';
import { useT } from '../../i18n/useT';
import type { MessageKey } from '../../i18n/i18n';

const TITLE: Record<QuotaKind, MessageKey> = {
  positions: 'limit.title.positions',
  openings: 'limit.title.openings',
  endgames: 'limit.title.endgames',
};

/**
 * A page-level "Today's endgames: done · Unlocks in 4h 12m [Train unlimited]"
 * strip, shown where a free player lands once that daily limit is used up.
 */
export function DailyLimitBanner({ kind, limit, resetsAt }: { kind: QuotaKind; limit: number; resetsAt: number }) {
  const t = useT();
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 border-2 border-text-primary bg-surface-3 px-4 py-3"
      data-testid={`limit-banner-${kind}`}
    >
      <span className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-text-primary">{t(TITLE[kind])}</span>
        <DailyLimitCountdown resetsAt={resetsAt} />
      </span>
      <button
        type="button"
        className="btn-primary h-9 px-4 text-xs"
        onClick={() => openDailyLimit({ kind, limit, resetsAt })}
      >
        {t('limit.cta')}
      </button>
    </div>
  );
}
