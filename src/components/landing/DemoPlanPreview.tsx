import type { ReactNode } from 'react';
import { bookPlayersLabel } from '../../chess/bookFormat';
import type { DemoResult } from '../../services/landingDemoService';
import { formatPoints, type DemoEndgameStat, type DemoOpeningStat } from '../../services/demoPlan';
import { EndgameIcon } from '../icons/EndgameIcon';
import { KingIcon } from '../icons/KingIcon';
import { OpeningIcon } from '../icons/OpeningIcon';
import { TrainIcon } from '../icons/TrainIcon';

/**
 * Signed-out "Your plan for today", built from the demo's own games: the
 * blunders to train, the opening they play most and where they left theory,
 * and what endgames cost them. Same order as the signed-in plan, Play last.
 */
export function DemoPlanPreview({ result }: { result: DemoResult }) {
  const { plan, blundersFound, gamesAnalyzed } = result;
  return (
    <section className="border-2 border-text-primary bg-surface" data-testid="demo-plan" aria-labelledby="demo-plan-heading">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-text-primary px-4 py-3 sm:px-6">
        <h2 id="demo-plan-heading" className="font-mono uppercase tracking-tight text-base sm:text-lg text-text-primary">
          Your plan for today
        </h2>
        <span className="font-mono uppercase text-[10px] tracking-tight text-text-primary">
          From your last {gamesAnalyzed} game{gamesAnalyzed === 1 ? '' : 's'}
        </span>
      </header>
      <ol className="divide-y-2 divide-text-primary/15">
        <Step icon={<TrainIcon className="h-5 w-5" />} title={trainTitle(blundersFound)} testId="demo-plan-train">
          {blundersFound > 0
            ? 'Positions from these games where you missed the best move. Try the first one below.'
            : "These games came out clean. Sign up and we'll check your full history."}
        </Step>
        <Step
          icon={<OpeningIcon className="h-5 w-5" />}
          title={plan.opening ? `Openings: ${plan.opening.family}` : 'Openings'}
          testId="demo-plan-openings"
        >
          <OpeningLine stat={plan.opening} total={gamesAnalyzed} />
        </Step>
        <Step icon={<EndgameIcon className="h-5 w-5" />} title="Endgames" testId="demo-plan-endgames">
          <EndgameLine stat={plan.endgame} />
        </Step>
        <Step icon={<KingIcon color="white" className="h-5 w-5" />} title="Play a game" testId="demo-plan-play">
          Once the rest is done. Its blunders join tomorrow's plan.
        </Step>
      </ol>
    </section>
  );
}

function trainTitle(n: number): string {
  if (n === 0) return 'Train your blunders';
  return `Train ${n} of your blunder${n === 1 ? '' : 's'}`;
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
  if (!stat) {
    return <>These games were too short to name an opening. Your plan picks it up from your full history.</>;
  }
  const share = `You played it in ${stat.games} of ${total} game${total === 1 ? '' : 's'} (${stat.sharePct}%).`;
  if (stat.exit) {
    const where =
      stat.exitGames > 1
        ? `You left theory early in ${stat.exitGames} of them, first at move ${stat.exit.moveNumber} with ${stat.exit.playedSan}.`
        : `You left theory at move ${stat.exit.moveNumber} with ${stat.exit.playedSan}.`;
    const who =
      stat.exit.theorySan && stat.exit.tier
        ? ` ${capitalize(bookPlayersLabel(stat.exit.tier))} mostly play ${stat.exit.theorySan} there.`
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
        {share} You kept to theory in{' '}
        {stat.checkedGames === 1 ? 'the game we could check' : `all ${stat.checkedGames} games we could check`}. Your
        plan reviews it as new games come in.
      </>
    );
  }
  return <>{share}</>;
}

function EndgameLine({ stat }: { stat: DemoEndgameStat }) {
  if (stat.pointsDropped > 0) {
    return (
      <>
        Endgame slips cost you {formatPoints(stat.pointsDropped)} in these games. Your plan replays those endgames until
        you hold them.
      </>
    );
  }
  if (stat.blunders > 0) {
    return (
      <>
        {stat.blunders} endgame blunder{stat.blunders === 1 ? '' : 's'}, none that cost a result this time. Your plan
        drills {stat.blunders === 1 ? 'it' : 'them'} anyway.
      </>
    );
  }
  return <>No endgame slips in these games. Your plan keeps watching the next ones.</>;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
