import type { ReactNode } from 'react';
import { bookPlayersLabel } from '../../chess/bookFormat';
import type { DemoResult } from '../../services/landingDemoService';
import { formatPoints, type DemoEndgameStat, type DemoOpeningStat } from '../../services/demoPlan';
import { EndgameIcon } from '../icons/EndgameIcon';
import { KingIcon } from '../icons/KingIcon';
import { OpeningIcon } from '../icons/OpeningIcon';
import { TrainIcon } from '../icons/TrainIcon';
import { useT } from '../../i18n/useT';

/**
 * Signed-out "Your plan for today", built from the demo's own games: the
 * blunders to train, the opening they play most and where they left theory,
 * and what endgames cost them. Same order as the signed-in plan, Play last.
 */
export function DemoPlanPreview({ result }: { result: DemoResult }) {
  const t = useT();
  const { plan, blundersFound, gamesAnalyzed } = result;
  return (
    <section className="border-2 border-text-primary bg-surface" data-testid="demo-plan" aria-labelledby="demo-plan-heading">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-text-primary px-4 py-3 sm:px-6">
        <h2 id="demo-plan-heading" className="font-mono uppercase tracking-tight text-base sm:text-lg text-text-primary">
          {t('demo.plan.title')}
        </h2>
        <span className="font-mono uppercase text-[10px] tracking-tight text-text-primary">
          {t('demo.plan.from', { count: gamesAnalyzed })}
        </span>
      </header>
      <ol className="divide-y-2 divide-text-primary/15">
        <Step icon={<TrainIcon className="h-5 w-5" />} title={blundersFound === 0 ? t('demo.plan.trainNone') : t('demo.plan.train', { count: blundersFound })} testId="demo-plan-train">
          {blundersFound > 0 ? t('demo.plan.trainBody') : t('demo.plan.trainClean')}
        </Step>
        <Step
          icon={<OpeningIcon className="h-5 w-5" />}
          title={plan.opening ? t('demo.plan.openingsFamily', { family: plan.opening.family }) : t('demo.plan.openings')}
          testId="demo-plan-openings"
        >
          <OpeningLine stat={plan.opening} total={gamesAnalyzed} />
        </Step>
        <Step icon={<EndgameIcon className="h-5 w-5" />} title={t('demo.plan.endgames')} testId="demo-plan-endgames">
          <EndgameLine stat={plan.endgame} />
        </Step>
        <Step icon={<KingIcon color="white" className="h-5 w-5" />} title={t('demo.plan.play')} testId="demo-plan-play">
          {t('demo.plan.playBody')}
        </Step>
      </ol>
    </section>
  );
}

function Step({ icon, title, testId, children }: { icon: ReactNode; title: string; testId: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 px-4 py-4 sm:px-6" data-testid={testId}>
      <span className="mt-0.5 shrink-0 text-gold-dark">{icon}</span>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-sans font-semibold text-text-primary">{title}</span>
        <p className="text-sm text-text-primary">{children}</p>
      </div>
    </li>
  );
}

function OpeningLine({ stat, total }: { stat: DemoOpeningStat | null; total: number }) {
  const t = useT();
  if (!stat) {
    return <>{t('demo.plan.tooShort')}</>;
  }
  const share = t('demo.plan.share', { count: total, games: stat.games, pct: stat.sharePct });
  if (stat.exit) {
    const where =
      stat.exitGames > 1
        ? t('demo.plan.leftEarlyMany', { count: stat.exitGames, move: stat.exit.moveNumber, san: stat.exit.playedSan })
        : t('demo.plan.leftAt', { move: stat.exit.moveNumber, san: stat.exit.playedSan });
    const who =
      stat.exit.theorySan && stat.exit.tier
        ? ` ${capitalize(t('demo.plan.theyPlay', { who: bookPlayersLabel(stat.exit.tier, t), san: stat.exit.theorySan }))}`
        : '';
    return (
      <>
        {share} {where}
        {who}
      </>
    );
  }
  if (stat.checkedGames > 0) {
    return (
      <>
        {share}{' '}
        {stat.checkedGames === 1 ? t('demo.plan.keptOne') : t('demo.plan.keptAll', { count: stat.checkedGames })}
      </>
    );
  }
  return <>{share}</>;
}

function EndgameLine({ stat }: { stat: DemoEndgameStat }) {
  const t = useT();
  if (stat.pointsDropped > 0) {
    return <>{t('demo.plan.endgameCost', { points: formatPoints(stat.pointsDropped, t) })}</>;
  }
  if (stat.blunders > 0) {
    return <>{t('demo.plan.endgameBlunders', { count: stat.blunders })}</>;
  }
  return <>{t('demo.plan.endgameClean')}</>;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
