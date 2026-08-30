import { useNavigate } from 'react-router-dom';
import { useEndgameScenarios } from '../../hooks/useEndgameScenarios';
import {
  EndgameScenario,
  SCENARIO_STATUS_LABEL,
  ScenarioStatus,
} from '../../models/endgameScenario';
import { InsightCardSkeleton } from '../Skeleton';

/** Chess-score formatting from half-points: 7 → "3½", 2 → "1", 1 → "½". */
function formatHalfPoints(halfPoints: number): string {
  const whole = Math.floor(halfPoints / 2);
  const frac = halfPoints % 2 === 1 ? '½' : '';
  return whole > 0 ? `${whole}${frac}` : frac || '0';
}

/** Half-points the game result fell short of the deserved result. */
function droppedHalfPoints(s: EndgameScenario): number {
  if (s.deservedResult === 'win') return s.actualResult === 'loss' ? 2 : 1;
  return 1; // holdable position, lost
}

/**
 * Dashboard summary of the /endgames trainer: how many dropped-point endgames
 * the scan found, split by what was dropped, with rescue progress and a CTA to
 * go play them out. Hidden until the user has at least one scenario.
 */
export function EndgameRescueCard() {
  const navigate = useNavigate();
  const scenariosQuery = useEndgameScenarios();

  if (scenariosQuery.isPending) {
    // While disabled (no user/games yet) the query never resolves — only show
    // the skeleton when a scan is actually in flight.
    return scenariosQuery.isFetching ? <InsightCardSkeleton rows={3} /> : null;
  }

  const scenarios = scenariosQuery.data ?? [];
  if (scenarios.length === 0) return null;

  const groups = [
    { key: 'win', title: 'Missed wins', items: scenarios.filter((s) => s.deservedResult === 'win') },
    { key: 'draw', title: 'Missed draws', items: scenarios.filter((s) => s.deservedResult === 'draw') },
  ].filter((g) => g.items.length > 0);

  const unrescued = scenarios.filter((s) => s.status !== 'passed');
  const atStakeHalf = unrescued.reduce((sum, s) => sum + droppedHalfPoints(s), 0);
  const allRescued = unrescued.length === 0;
  const pendingCount = scenarios.filter((s) => s.status === 'pending').length;
  const statusCounts = (['pending', 'failed', 'passed'] as ScenarioStatus[])
    .map((status) => ({ status, n: scenarios.filter((s) => s.status === status).length }))
    .filter((x) => x.n > 0);

  return (
    <section className="card flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <span className="label">Dropped endgames</span>
        <span className="text-text-secondary text-xs tabular-nums">
          {scenarios.length} endgame{scenarios.length === 1 ? '' : 's'}
        </span>
      </header>

      <div className="flex items-end gap-3">
        <span className="font-mono text-4xl tabular-nums tracking-tight text-gold-dark">
          {formatHalfPoints(atStakeHalf)}
        </span>
        <span className="text-text-secondary mb-1">
          {allRescued
            ? 'every dropped point rescued'
            : `point${atStakeHalf > 2 ? 's' : ''} waiting to be rescued`}
        </span>
      </div>

      <div className="flex flex-col divide-y divide-text-primary/15">
        {groups.map((g) => {
          const rescued = g.items.filter((s) => s.status === 'passed').length;
          return (
            <div key={g.key} className="flex flex-col gap-1.5 py-2.5 px-1">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-text-primary">{g.title}</span>
                <span className="tabular-nums text-text-secondary">
                  <span className="text-text-primary">{rescued}</span>/{g.items.length} rescued
                </span>
              </div>
              <div className="relative h-2 rounded-none bg-text-primary/10 overflow-hidden border border-text-primary/20">
                <div
                  className="absolute inset-y-0 left-0 rounded-none bg-correct"
                  style={{ width: `${(rescued / g.items.length) * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-text-secondary text-xs">
        {statusCounts
          .map((x) => `${x.n} ${SCENARIO_STATUS_LABEL[x.status].toLowerCase()}`)
          .join(' · ')}
        {' — '}play these endgames out against the engine and keep the point this time.
      </p>

      <button className="btn-primary w-full" onClick={() => navigate('/endgames')}>
        {pendingCount > 0 ? 'Play them out' : allRescued ? 'Play them again' : 'Try them again'}
      </button>
    </section>
  );
}
