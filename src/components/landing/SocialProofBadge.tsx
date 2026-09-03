import { useCountUp } from '../../hooks/useCountUp';
import { useInView } from '../../hooks/useInView';
import { LANDING_STATS_SNAPSHOT, useLandingStats } from '../../hooks/useLandingStats';

const numberFormat = new Intl.NumberFormat('en-US');

/**
 * Social-proof stat card: global positions-reviewed and ELO-gained totals
 * across all accounts, framed in the same bordered-card language as the rest
 * of the landing page. The numbers count up once the card scrolls into view.
 * Renders from the build-time snapshot on first paint (so it is part of the
 * prerendered HTML and never pops into the layout), then updates in place when
 * the live RPC resolves.
 */
export function SocialProofBadge() {
  const { data: live } = useLandingStats();
  const { ref, inView } = useInView<HTMLElement>(0.3);

  // Fall back to the build-time snapshot rather than unmounting: once this
  // card has been laid out, removing it would shift everything below it.
  const data = live ?? LANDING_STATS_SNAPSHOT;
  if (data.positionsReviewed <= 0 && data.eloGained <= 0) return null;

  return (
    <section ref={ref} className="border-b-2 border-text-primary">
      <div className="max-w-6xl mx-auto px-6 py-12 lg:py-16">
        <div className="border-2 border-text-primary bg-surface">
          <div className="flex items-center gap-2.5 border-b-2 border-text-primary px-5 py-3">
            <span className="h-2 w-2 rounded-full bg-gold-dark" aria-hidden />
            <span className="font-mono uppercase text-[10px] tracking-[0.18em] text-text-secondary">
              Across every PatternChess account
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y-2 sm:divide-y-0 sm:divide-x-2 divide-text-primary">
            <Stat target={data.positionsReviewed} label="Positions reviewed" active={inView} />
            <Stat
              target={data.eloGained}
              label="ELO gained by players"
              prefix="+"
              accent
              active={inView}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({
  target,
  label,
  active,
  prefix = '',
  accent = false,
}: {
  target: number;
  label: string;
  active: boolean;
  prefix?: string;
  accent?: boolean;
}) {
  const value = useCountUp(target, active);
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-8 lg:py-10 text-center">
      <div
        className={
          'font-mono tracking-tight text-4xl sm:text-5xl leading-none tabular-nums ' +
          (accent ? 'text-gold-dark' : 'text-text-primary')
        }
      >
        {prefix}
        {numberFormat.format(value)}
      </div>
      <div className="font-mono uppercase text-[11px] tracking-[0.12em] text-text-secondary">
        {label}
      </div>
    </div>
  );
}
