import { Link } from 'react-router-dom';
import { FlairBadge } from '../FlairBadge';
import { PUBLIC_LEADERBOARD_SNAPSHOT, usePublicLeaderboard } from '../../hooks/usePublicLeaderboard';
import { trackCtaClick } from '../../services/funnelService';

const numberFormat = new Intl.NumberFormat('en-US');

/** Fewer rows than this reads as an empty gym; hide the section instead. */
const MIN_ROWS = 3;

/**
 * Top 5 trainers by positions solved over the last 7 days. Renders from the
 * build-time snapshot on first paint (prerendered HTML), then updates in place
 * from the anon `public_leaderboard` RPC.
 */
export function WeeklyLeaderboard() {
  const { data: live } = usePublicLeaderboard();
  const data = live ?? PUBLIC_LEADERBOARD_SNAPSHOT;
  if (data.rows.length < MIN_ROWS) return null;

  return (
    <section className="border-b-2 border-text-primary">
      <div className="max-w-6xl mx-auto px-6 py-16 lg:py-20">
        <div className="mb-10 border-b-2 border-text-primary pb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-mono uppercase tracking-tight text-2xl sm:text-3xl text-text-primary">
            Top trainers this week
          </h2>
          <span className="font-mono uppercase text-[10px] tracking-[0.12em] text-text-secondary">
            Positions solved · last 7 days
          </span>
        </div>
        <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6 items-start">
          <ol className="m-0 p-0 list-none border-2 border-text-primary bg-surface divide-y-2 divide-text-primary">
            {data.rows.map((r) => (
              <li key={`${r.rank}-${r.label}`} className="flex items-center gap-4 px-5 py-3.5">
                <span
                  className={
                    'font-mono tabular-nums text-lg w-6 shrink-0 ' +
                    (r.rank === 1 ? 'text-gold-dark' : 'text-text-secondary')
                  }
                >
                  {r.rank}
                </span>
                <span className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="truncate text-text-primary">{r.label}</span>
                  <FlairBadge flair={r.flair} className="hidden sm:inline-flex" />
                </span>
                <span className="font-mono tabular-nums text-text-primary">
                  {numberFormat.format(r.value)}
                </span>
              </li>
            ))}
          </ol>
          <div className="border-2 border-text-primary bg-text-primary text-bg p-6 flex flex-col gap-4">
            <div>
              <div className="font-mono uppercase tracking-tight text-sm sm:text-base">
                Your name could be here.
              </div>
              <div className="font-sans text-bg/70 text-sm mt-1">
                Every position you solve from your own games counts toward the weekly board.
              </div>
            </div>
            <Link
              to="/login"
              onClick={() => trackCtaClick('leaderboard')}
              className="self-start font-mono uppercase tracking-tight text-sm border-2 border-bg bg-gold-dark text-bg px-6 py-3 rounded-none shadow-[3px_3px_0_#F4F4F0] hover:shadow-[1px_1px_0_#F4F4F0] hover:translate-x-[2px] hover:translate-y-[2px] transition-all whitespace-nowrap"
            >
              Sign up free to join →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
