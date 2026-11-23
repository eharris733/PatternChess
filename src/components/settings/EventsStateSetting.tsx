import { useEventsRegion } from '../../hooks/useEventsRegion';
import { regionName } from '../../lib/eventRegions';
import { RegionPicker } from '../insights/UpcomingEventsCard';
import { useT } from '../../i18n/useT';

/**
 * "Events near you" on /profile: the country (and US state) OTB tournaments
 * are listed for (dashboard card + the weekly email). Reads and writes only
 * through `useEventsRegion`; "Clear" drops the saved place, and the dashboard
 * falls back to the approximate-location guess.
 */
export function EventsStateSetting() {
  const t = useT();
  const { region, saved, error, setRegion } = useEventsRegion();

  return (
    <div className="flex flex-col gap-2" data-testid="profile-events-state">
      <h3 className="label">{t('events.title')}</h3>
      <p className="text-text-primary text-sm">{t('events.help')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <RegionPicker value={region} onPick={setRegion} compact={false} />
        {saved ? (
          <button type="button" className="btn-ghost h-9 px-2 text-xs underline" onClick={() => setRegion(null)}>
            {t('events.clear')}
          </button>
        ) : (
          region && <span className="text-xs text-text-primary">{t('events.notSetShowing', { state: regionName(region) })}</span>
        )}
      </div>
      {error && <p className="text-incorrect text-sm">{error}</p>}
    </div>
  );
}
