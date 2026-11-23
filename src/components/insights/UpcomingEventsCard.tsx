import { useMemo } from 'react';
import { useUpcomingEvents } from '../../hooks/useUpcomingEvents';
import { useRatingProgress } from '../../hooks/useRatingProgress';
import { useEventsRegion } from '../../hooks/useEventsRegion';
import { isUsStateCode, US_STATES } from '../../lib/usStates';
import {
  EVENT_COUNTRIES,
  US_COUNTRY,
  isEventCountryCode,
  regionHasListings,
  regionName,
  type EventsRegion,
} from '../../lib/eventRegions';
import {
  eventsRegionUrl,
  type OtbEvent,
  type OtbOccurrence,
} from '../../services/eventsApiService';
import { InsightCardSkeleton } from '../Skeleton';

const TOP_N = 3;
/** A contiguous "occurrence" longer than this is a season-long listing (some
 * aggregator rows span months), not a tournament day: left out. */
const MAX_BLOCK_DAYS = 31;
const DAY_MS = 86_400_000;

/** A block already under way sorts as today. */
function sortDay(o: OtbOccurrence, today: string): string {
  return o.date < today ? today : o.date;
}

function spanDays(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS);
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-03" → "Sep 3"; multi-day "2026-08-05".."2026-08-26" → "Aug 5–26". */
function formatDateRange(start: string, end: string): string {
  const [, sm, sd] = start.split('-').map(Number);
  const [, em, ed] = end.split('-').map(Number);
  if (!sm || !sd) return start;
  const from = `${MONTHS[sm - 1]} ${sd}`;
  if (start === end || !em || !ed) return from;
  return sm === em ? `${from}–${ed}` : `${from} – ${MONTHS[em - 1]} ${ed}`;
}

/** YYYY-MM-DD in the user's local timezone. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** OTB proxy rating: slowest online category the user actually plays. */
function useProxyRating(): number | null {
  const { progress } = useRatingProgress();
  return useMemo(() => {
    for (const category of ['classical', 'rapid', 'blitz', 'bullet'] as const) {
      const entry = progress.find((p) => p.category === category);
      if (entry?.series.length) {
        return Math.max(...entry.series.map((s) => s.latestRating));
      }
    }
    return null;
  }, [progress]);
}

/** The tightest U-section the user's rating qualifies for, e.g. "U1700". */
function matchingSection(event: OtbEvent, rating: number | null): string | null {
  if (rating === null || !event.sections) return null;
  let best: { name: string; limit: number } | null = null;
  for (const name of event.sections) {
    const limit = Number(name.match(/^U(\d{3,4})$/i)?.[1]);
    if (limit && rating < limit && (!best || limit < best.limit)) best = { name, limit };
  }
  return best?.name ?? null;
}

/**
 * Country, then state for the US, in the card header; picking saves it.
 * A guessed country with no listings ('BR') shows as an extra first option.
 */
export function RegionPicker({
  value,
  onPick,
  compact = true,
}: {
  value: EventsRegion | null;
  onPick: (r: EventsRegion) => void;
  compact?: boolean;
}) {
  const cls = compact ? 'input h-8 w-auto py-0 pl-2 pr-7 text-xs' : 'input w-full sm:w-64';
  const country = value?.country ?? '';
  const uncovered = country && !isEventCountryCode(country) ? country : null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <select
        className={cls}
        aria-label="Your country"
        data-testid="events-country"
        value={country}
        onChange={(e) => {
          const next = e.currentTarget.value;
          if (!isEventCountryCode(next)) return;
          onPick({ country: next, state: next === US_COUNTRY && value?.country === US_COUNTRY ? value.state : null });
        }}
      >
        {!country && <option value="">Pick a country</option>}
        {uncovered && <option value={uncovered}>{regionName({ country: uncovered, state: null })}</option>}
        {EVENT_COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
      {country === US_COUNTRY && (
        <select
          className={cls}
          aria-label="Your state"
          data-testid="events-state"
          value={value?.state ?? ''}
          onChange={(e) => {
            const next = e.currentTarget.value;
            if (isUsStateCode(next)) onPick({ country: US_COUNTRY, state: next });
          }}
        >
          {!value?.state && <option value="">Pick a state</option>}
          {US_STATES.map((st) => (
            <option key={st.code} value={st.code}>
              {st.name}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}

export function UpcomingEventsCard() {
  const where = useEventsRegion();
  const region = where.region;
  const listed = regionHasListings(region);
  const events = useUpcomingEvents(region);
  const rating = useProxyRating();

  if (where.resolving || (listed && events.isPending)) return <InsightCardSkeleton rows={3} />;
  // Quiet card: an unreachable events service should never degrade the dashboard.
  if (listed && (events.isError || !events.data)) return null;

  const name = region ? regionName(region) : null;
  const header = (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <span className="label">Upcoming OTB events</span>
      <RegionPicker value={region} onPick={where.setRegion} />
    </header>
  );

  // No listings for this place (a country we don't cover yet, or the US with
  // no state known): say so and keep the picker, never a blank card.
  if (!listed || !region || !events.data) {
    return (
      <section className="card flex flex-col gap-3" data-testid="upcoming-events">
        {header}
        <p className="text-sm text-text-primary" data-testid="events-none">
          {!region
            ? 'Pick where you play to see tournaments near you.'
            : region.country === US_COUNTRY && !region.state
              ? 'Pick your state to see tournaments near you.'
              : `No tournaments listed in ${name} yet.`}
        </p>
      </section>
    );
  }

  // Day-based: each event's NEXT meeting day (a month-long weekly Swiss shows
  // as "Aug 25 · Rd 4/4", not "Aug 4–25"), nearest days first; a block
  // already under way counts as today.
  const today = localToday();
  const upcoming = events.data
    .map((event) => ({
      event,
      next: event.occurrences.find((o) => o.endDate >= today) ?? null,
    }))
    .filter(
      (x): x is { event: OtbEvent; next: OtbOccurrence } =>
        x.next !== null && spanDays(x.next.date, x.next.endDate) <= MAX_BLOCK_DAYS,
    )
    .sort((a, b) => sortDay(a.next, today).localeCompare(sortDay(b.next, today)))
    .slice(0, TOP_N);

  return (
    <section className="card flex flex-col gap-3" data-testid="upcoming-events">
      {header}
      {!where.saved && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-primary"
          data-testid="events-state-guess"
        >
          <span>Showing {name}, from your approximate location.</span>
          <button
            type="button"
            className="font-mono uppercase text-[10px] tracking-tight text-gold-dark hover:text-text-primary transition-colors"
            onClick={() => where.setRegion(region)}
          >
            Save {name}
          </button>
        </div>
      )}
      {where.error && <p className="text-incorrect text-xs">{where.error}</p>}
      {upcoming.length === 0 ? (
        <p className="text-sm text-text-primary py-2">No tournaments listed in {name} right now.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-text-primary/15">
          {upcoming.map(({ event, next }) => {
            const section = matchingSection(event, rating);
            return (
              <li key={event.id}>
                <a
                  href={event.eventUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between py-2.5 gap-3 w-full text-left hover:bg-text-primary/5 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-text-primary text-sm font-semibold truncate">{event.title}</p>
                    <p className="text-text-primary text-xs truncate">
                      {next.round !== null ? `Rd ${next.round} of ${next.totalRounds} · ` : ''}
                      {event.clubName}
                      {event.clubCity ? ` · ${event.clubCity}` : ''}
                      {section ? (
                        <span className="text-gold-dark"> · has a {section} section</span>
                      ) : null}
                    </p>
                  </div>
                  <span className="text-text-primary text-xs font-mono uppercase tracking-tight tabular-nums shrink-0">
                    {formatDateRange(next.date, next.endDate)}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
      <a
        href={eventsRegionUrl(region)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono uppercase text-[10px] tracking-tight text-gold-dark hover:text-text-primary transition-colors"
      >
        All {name} tournaments →
      </a>
    </section>
  );
}
