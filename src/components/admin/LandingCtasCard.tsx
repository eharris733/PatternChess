import { useLandingCtas } from '../../hooks/useOutreach';

const SOURCE_LABEL: Record<string, string> = {
  topbar_signup: 'Top bar · Sign up',
  topbar_login: 'Top bar · Log in',
  demo_result: 'Demo result',
  demo_clean: 'Demo (no blunders)',
  leaderboard: 'Weekly leaderboard',
  wb: 'Win-back link',
};

/** Landing sign-up clicks per section + win-back link returns, last 30 days. */
export function LandingCtasCard() {
  const { data } = useLandingCtas(30);
  if (!data || data.length === 0) return null;
  const clicks = data.filter((r) => r.type === 'cta_click');
  const returns = data.filter((r) => r.type === 'lead_return');

  return (
    <section className="card flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <span className="label">Sign-up clicks</span>
        <span className="text-text-secondary text-xs">last 30 days · visitors</span>
      </header>
      <div className="flex flex-col divide-y-2 divide-text-primary/10">
        {clicks.map((r) => (
          <Row key={`c-${r.source}`} label={SOURCE_LABEL[r.source] ?? r.source} visitors={r.visitors} />
        ))}
        {returns.map((r) => (
          <Row
            key={`r-${r.source}`}
            label={`Returned via ${SOURCE_LABEL[r.source] ?? r.source}`}
            visitors={r.visitors}
          />
        ))}
      </div>
    </section>
  );
}

function Row({ label, visitors }: { label: string; visitors: number }) {
  return (
    <div className="flex items-center justify-between py-2 first:pt-0 text-sm">
      <span className="text-text-primary">{label}</span>
      <span className="tabular-nums text-text-primary">{visitors.toLocaleString()}</span>
    </div>
  );
}
