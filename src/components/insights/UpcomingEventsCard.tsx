import { useMemo } from 'react';
import { useUpcomingEvents } from '../../hooks/useUpcomingEvents';
import { useRatingProgress } from '../../hooks/useRatingProgress';
import { useEventsState } from '../../hooks/useEventsState';
import { isUsStateCode, US_STATES, usStateName, type UsStateCode } from '../../lib/usStates';
import {
  eventsStateUrl,
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

/** Compact state picker in the card header; picking a state saves it. */
function StatePicker({ value, onPick }: { value: UsStateCode; onPick: (s: UsStateCode) => void }) {
  return (
    <select
      className="input h-8 w-auto py-0 pl-2 pr-7 text-xs"
      aria-label="Your state"
      data-testid="events-state"
      value={value}
      onChange={(e) => {
        const next = e.currentTarget.value;
        if (isUsStateCode(next)) onPick(next);
      }}
    >
      {US_STATES.map((s) => (
        <option key={s.code} value={s.code}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

export function UpcomingEventsCard() {
  const where = useEventsState();
  const events = useUpcomingEvents(where.state);
  const rating = useProxyRating();

  if (where.resolving || (where.state !== null && events.isPending)) return <InsightCardSkeleton rows={3} />;
  // Outside the US with nothing saved: no card.
  if (where.state === null) return null;
  // Quiet card: an unreachable events service should never degrade the dashboard.
  if (events.isError || !events.data) return null;

  const state = where.state;
  const stateName = usStateName(state);

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
      <header className="flex items-center justify-between gap-3">
        <span className="label">Upcoming OTB events</span>
        <StatePicker value={state} onPick={where.setState} />
      </header>
      {!where.saved && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-primary"
          data-testid="events-state-guess"
        >
          <span>Showing {stateName}, based on where you are.</span>
          <button
            type="button"
            className="font-mono uppercase text-[10px] tracking-tight text-gold-dark hover:text-text-primary transition-colors"
            onClick={() => where.setState(state)}
          >
            Save {stateName}
          </button>
        </div>
      )}
      {where.error && <p className="text-incorrect text-xs">{where.error}</p>}
      {upcoming.length === 0 ? (
        <p className="text-sm text-text-primary py-2">No tournaments listed in {stateName} right now.</p>
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
                    <p className="text-text-secondary text-xs truncate">
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
        href={eventsStateUrl(state)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono uppercase text-[10px] tracking-tight text-gold-dark hover:text-text-primary transition-colors"
      >
        All {stateName} tournaments →
      </a>
    </section>
  );
}
