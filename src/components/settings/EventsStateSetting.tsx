import { useEventsState } from '../../hooks/useEventsState';
import { isUsStateCode, US_STATES, usStateName } from '../../lib/usStates';

/**
 * "Events near you" on /profile: the US state OTB tournaments are listed for
 * (dashboard card + the weekly email). Reads and writes only through
 * `useEventsState`; "Not set" clears `profiles.events_state`, and the dashboard
 * falls back to its location guess.
 */
export function EventsStateSetting() {
  const { state, saved, error, setState } = useEventsState();
  const value = saved && state ? state : '';

  return (
    <div className="flex flex-col gap-2" data-testid="profile-events-state">
      <h3 className="label">Events near you</h3>
      <p className="text-text-primary text-sm">
        Over-the-board tournaments in your state show on your dashboard and in your Sunday email.
      </p>
      <select
        className="input w-full sm:w-64"
        aria-label="Your state for events"
        value={value}
        onChange={(e) => {
          const next = e.currentTarget.value;
          if (next === '') setState(null);
          else if (isUsStateCode(next)) setState(next);
        }}
      >
        <option value="">{!saved && state ? `Not set (showing ${usStateName(state)})` : 'Not set'}</option>
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
