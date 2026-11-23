import { formatOpeningDisplay, resolveOpeningName } from '../../chess/openingNames';
import { useT } from '../../i18n/useT';

interface Props {
  gamesAnalyzed: number;
  blundersFound: number;
  biggestSwing: number | null;
  eco: string | null;
  openingName: string | null;
}

export function DemoStatsCard({
  gamesAnalyzed,
  blundersFound,
  biggestSwing,
  eco,
  openingName,
}: Props) {
  const t = useT();
  const opening = formatOpeningDisplay(resolveOpeningName(eco, openingName));
  return (
    <div className="border-2 border-text-primary bg-surface">
      <div className="grid grid-cols-3 divide-x-2 divide-text-primary">
        <Stat label={t('demo.stats.games')} value={String(gamesAnalyzed)} />
        <Stat label={t('demo.stats.blunders')} value={String(blundersFound)} />
        <Stat
          label={t('demo.stats.swing')}
          value={biggestSwing != null ? `${biggestSwing}%` : '—'}
          accent={biggestSwing != null}
        />
      </div>
      {opening && (
        <div className="border-t-2 border-text-primary px-4 py-3 flex items-center justify-between gap-4">
          <span className="font-mono uppercase text-[10px] tracking-tight text-text-secondary">
            {t('demo.stats.opening')}
          </span>
          <span className="font-mono uppercase text-xs tracking-tight text-text-primary truncate">
            {opening}
          </span>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="p-4 sm:p-6">
      <div className="font-mono uppercase text-[10px] tracking-tight text-text-secondary mb-2">
        {label}
      </div>
      <div
        className={
          'font-mono text-2xl sm:text-3xl tracking-tight ' +
          (accent ? 'text-gold-dark' : 'text-text-primary')
        }
      >
        {value}
      </div>
    </div>
  );
}
