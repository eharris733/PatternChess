import { useEventsState } from '../../hooks/useEventsState';
import { isUsStateCode, US_STATES, usStateName } from '../../lib/usStates';
import { useT } from '../../i18n/useT';

/**
 * "Events near you" on /profile: the US state OTB tournaments are listed for
 * (dashboard card + the weekly email). Reads and writes only through
 * `useEventsState`; "Not set" clears `profiles.events_state`, and the dashboard
 * falls back to its location guess.
 */
export function EventsStateSetting() {
  const t = useT();
  const { state, saved, error, setState } = useEventsState();
  const value = saved && state ? state : '';

  return (
    <div className="flex flex-col gap-2" data-testid="profile-events-state">
      <h3 className="label">{t('events.title')}</h3>
      <p className="text-text-primary text-sm">
        {t('events.help')}
      </p>
      <select
        className="input w-full sm:w-64"
        aria-label={t('events.stateAria')}
        value={value}
        onChange={(e) => {
          const next = e.currentTarget.value;
          if (next === '') setState(null);
          else if (isUsStateCode(next)) setState(next);
        }}
      >
        <option value="">{!saved && state ? t('events.notSetShowing', { state: usStateName(state) }) : t('events.notSet')}</option>
        {US_STATES.map((s) => (
          <option key={s.code} value={s.code}>
            {s.name}
          </option>
        ))}
      </select>
      {error && <p className="text-incorrect text-sm">{error}</p>}
    </div>
  );
}
