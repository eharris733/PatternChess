import { useState } from 'react';
import { useQuotaGuard } from '../../hooks/useDailyQuota';
import { useNavigate } from 'react-router-dom';
import { useSyncStore } from '../../state/syncStore';
import { supabaseService } from '../../services/supabaseService';
import { freshBlunderLine } from '../../content/freshBlunderLines';
import { CloseIcon } from '../icons/CloseIcon';
import { TrainIcon } from '../icons/TrainIcon';
import { useT } from '../../i18n/useT';

/**
 * Celebrates the blunders the latest sync found in newly played games:
 * blunders are fuel, and this is the moment to say so. "Train them now"
 * drills exactly those positions (blunderIds), ahead of the regular queue.
 * Shown until dismissed or the tab reloads (state lives in syncStore).
 */
export function FreshBlundersCard() {
  const navigate = useNavigate();
  const t = useT();
  const finds = useSyncStore((s) => s.freshFinds);
  const clear = useSyncStore((s) => s.clearFreshFinds);
  const [starting, setStarting] = useState(false);
  const { guard } = useQuotaGuard();

  if (!finds || finds.games === 0) return null;

  const line = freshBlunderLine(finds.blunders, finds.games, finds.at, t);

  const train = async () => {
    if (!guard('positions')) return;
    setStarting(true);
    try {
      const ids = await supabaseService.getLiveBlunderIdsForGames(finds.gameIds);
      clear();
      navigate(
        '/training',
        ids.length > 0
          ? { state: { blunderIds: ids, focusLabel: t('fresh.focus') } }
          : undefined,
      );
    } catch {
      setStarting(false);
      navigate('/training');
    }
  };

  return (
    <section className="card flex items-start gap-3 border-gold-dark" data-testid="fresh-blunders-card" role="status">
      <TrainIcon className="mt-1 h-5 w-5 shrink-0 text-gold-dark" />
      <div className="flex flex-1 flex-col gap-2">
        <span className="label">{t('fresh.label')}</span>
        <p className="text-base text-text-primary">{line}</p>
        {finds.blunders > 0 && (
          <div>
            <button type="button" className="btn-primary h-9 px-4 text-xs" onClick={() => void train()} disabled={starting}>
              {starting ? t('common.loading') : t('fresh.trainNow')}
            </button>
          </div>
        )}
      </div>
      <button type="button" onClick={clear} aria-label={t('common.dismiss')} className="shrink-0 text-text-primary">
        <CloseIcon className="h-4 w-4" />
      </button>
    </section>
  );
}
