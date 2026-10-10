import { Link } from 'react-router-dom';
import { FlairBadge } from '../FlairBadge';
import { PUBLIC_LEADERBOARD_SNAPSHOT, usePublicLeaderboard } from '../../hooks/usePublicLeaderboard';
import { trackCtaClick } from '../../services/funnelService';
import type { PublicLeaderboardRow } from '../../services/db/leaderboard';

const numberFormat = new Intl.NumberFormat('en-US');

/** Fewer rows than this reads as an empty gym; hide the section instead. */
const MIN_ROWS = 3;

const PLATFORM_LABEL = { lichess: 'Lichess', chesscom: 'Chess.com' } as const;

/** "Lichess · 1540 Blitz"; whichever parts are known. */
function playerDetail(r: PublicLeaderboardRow): string | null {
  const parts: string[] = [];
  if (r.platform) parts.push(PLATFORM_LABEL[r.platform]);
  if (r.rating) {
    const cat = r.ratingCategory ? ` ${r.ratingCategory[0].toUpperCase()}${r.ratingCategory.slice(1)}` : '';
    parts.push(`${r.rating}${cat}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Top 5 trainers by blunders reviewed over the last 7 days. Renders from the
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
            Ranked by blunders reviewed in the last 7 days
          </span>
        </div>
        <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6 items-start">
          <div className="border-2 border-text-primary bg-surface">
            <div className="flex items-center gap-4 px-5 py-2 border-b-2 border-text-primary font-mono uppercase text-[10px] tracking-[0.12em] text-text-secondary">
              <span className="w-6 shrink-0">#</span>
              <span className="flex-1">Player</span>
              <span>Blunders reviewed</span>
            </div>
            <ol className="m-0 p-0 list-none divide-y-2 divide-text-primary">
              {data.rows.map((r) => {
                const detail = playerDetail(r);
                return (
                  <li key={`${r.rank}-${r.label}`} className="flex items-center gap-4 px-5 py-3">
                    <span
                      className={
                        'font-mono tabular-nums text-lg w-6 shrink-0 ' +
                        (r.rank === 1 ? 'text-gold-dark' : 'text-text-secondary')
                      }
                    >
                      {r.rank}
                    </span>
                    <span className="flex-1 min-w-0 flex flex-col">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="truncate text-text-primary">{r.label}</span>
                        <FlairBadge flair={r.flair} className="hidden sm:inline-flex" />
                      </span>
                      {detail && (
                        <span className="font-mono uppercase text-[10px] tracking-[0.08em] text-text-secondary truncate">
                          {detail}
                        </span>
                      )}
                    </span>
                    <span className="font-mono tabular-nums text-lg text-text-primary">
                      {numberFormat.format(r.value)}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="border-2 border-text-primary bg-text-primary text-bg p-6 flex flex-col gap-4">
            <div>
              <div className="font-mono uppercase tracking-tight text-sm sm:text-base">
                Your name could be here.
              </div>
              <div className="font-sans text-bg/70 text-sm mt-1">
                Every blunder from your own games that you review counts toward the weekly board.
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
