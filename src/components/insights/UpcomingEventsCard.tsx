import { useMemo } from 'react';
import { useUpcomingEvents } from '../../hooks/useUpcomingEvents';
import { useRatingProgress } from '../../hooks/useRatingProgress';
import {
  EVENTS_SITE_URL,
  type OtbEvent,
  type OtbOccurrence,
} from '../../services/eventsApiService';
import { InsightCardSkeleton } from '../Skeleton';

const TOP_N = 3;
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

export function UpcomingEventsCard() {
  const events = useUpcomingEvents();
  const rating = useProxyRating();

  if (events.isPending) return <InsightCardSkeleton rows={3} />;
  // Quiet card: an unreachable events service should never degrade the dashboard.
  if (events.isError || !events.data?.length) return null;

  // Day-based: each event's NEXT meeting day (a month-long weekly Swiss shows
  // as "Aug 25 · Rd 4/4", not "Aug 4–25"), nearest days first.
  const today = localToday();
  const upcoming = events.data
    .map((event) => ({
      event,
      next: event.occurrences.find((o) => o.endDate >= today) ?? null,
    }))
    .filter((x): x is { event: OtbEvent; next: OtbOccurrence } => x.next !== null)
    .sort((a, b) => a.next.date.localeCompare(b.next.date))
    .slice(0, TOP_N);

  return (
    <section className="card flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <span className="label">Upcoming OTB events</span>
        <span className="text-text-secondary text-xs uppercase tracking-tight">Massachusetts</span>
      </header>
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
      <a
        href={EVENTS_SITE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono uppercase text-[10px] tracking-tight text-gold-dark hover:text-text-primary transition-colors"
      >
        All Massachusetts tournaments →
      </a>
    </section>
  );
}
