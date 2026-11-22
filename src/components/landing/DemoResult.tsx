import { Link } from 'react-router-dom';
import type { UseDemoAnalysisReturn } from '../../hooks/useDemoAnalysis';
import { BlunderPreview } from './BlunderPreview';
import { DemoProgressPanel } from './DemoProgressPanel';
import { DemoStatsCard } from './DemoStatsCard';
import { trackCtaClick } from '../../services/funnelService';

interface Props {
  demo: UseDemoAnalysisReturn;
}

export function DemoResult({ demo }: Props) {
  if (demo.status === 'idle') return null;

  if (demo.status === 'loading') {
    return (
      <div className="flex flex-col gap-3">
        <DemoProgressPanel label={demo.progressLabel || 'Starting…'} />
        <p className="font-mono uppercase text-[10px] tracking-tight text-text-secondary">
          Running Stockfish in your browser. No data leaves your machine until you sign up.
        </p>
      </div>
    );
  }

  if (demo.status === 'error') {
    const notFound = demo.error?.code === 'not-found';
    return (
      <div className="border-2 border-text-primary bg-surface p-6">
        <div className="font-mono uppercase text-xs tracking-tight text-gold-dark mb-2">
          {notFound ? 'Player not found' : "Couldn't run the demo"}
        </div>
        <p className="text-text-primary mb-4">{demo.error?.message}</p>
        <button
          onClick={demo.reset}
          className="font-mono uppercase tracking-tight text-xs border-2 border-text-primary bg-transparent text-text-primary px-4 py-2 rounded-none hover:bg-text-primary hover:text-bg transition-colors"
        >
          {notFound ? 'Try a different username' : 'Try again'}
        </button>
      </div>
    );
  }

  const r = demo.result;
  if (!r) return null;

  if (demo.status === 'no-blunders') {
    return (
      <div className="flex flex-col gap-6">
        <DemoStatsCard
          gamesAnalyzed={r.gamesAnalyzed}
          blundersFound={0}
          biggestSwing={null}
          eco={r.eco}
          openingName={r.openingName}
        />
        <div className="border-2 border-text-primary bg-surface p-6">
          <div className="font-mono uppercase text-xs tracking-tight text-text-secondary mb-2">
            Suspiciously clean
          </div>
          <p className="text-text-primary mb-4">
            No trainable blunders in your last {r.gamesAnalyzed} game
            {r.gamesAnalyzed === 1 ? '' : 's'}. Either you're in form or we need more games. Sign up
            and we'll check your full history.
          </p>
          <SignUpCta source="demo_clean">Sign up free</SignUpCta>
        </div>
      </div>
    );
  }

  // success
  return (
    <div className="flex flex-col gap-6">
      <DemoStatsCard
        gamesAnalyzed={r.gamesAnalyzed}
        blundersFound={r.blundersFound}
        biggestSwing={r.biggestSwing}
        eco={r.eco}
        openingName={r.openingName}
      />
      {r.blunder && (
        <BlunderPreview
          blunder={r.blunder}
          moveLabel={`Move ${r.blunder.moveNumber} · ${r.blunder.sideToMove === 'white' ? 'White' : 'Black'} to move`}
        />
      )}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:justify-between border-2 border-text-primary bg-text-primary text-bg p-6">
        <div>
          <div className="font-mono uppercase tracking-tight text-sm sm:text-base">
            {r.blundersFound} blunder{r.blundersFound === 1 ? '' : 's'}. That's your training plan.
          </div>
          <div className="font-sans text-bg/70 text-sm mt-1">
            Sign up free. We'll give you a few a day until the right move is automatic.
          </div>
        </div>
        <SignUpCta source="demo_result">Start my plan →</SignUpCta>
      </div>
    </div>
  );
}

function SignUpCta({ children, source }: { children: React.ReactNode; source: string }) {
  return (
    <Link
      to="/login"
      onClick={() => trackCtaClick(source)}
      className="self-start font-mono uppercase tracking-tight text-sm border-2 border-bg bg-gold-dark text-bg px-6 py-3 rounded-none shadow-[3px_3px_0_#F4F4F0] hover:shadow-[1px_1px_0_#F4F4F0] hover:translate-x-[2px] hover:translate-y-[2px] transition-all whitespace-nowrap"
    >
      {children}
    </Link>
  );
}
