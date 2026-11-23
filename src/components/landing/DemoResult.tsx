import { Link } from 'react-router-dom';
import type { UseDemoAnalysisReturn } from '../../hooks/useDemoAnalysis';
import { BlunderPreview } from './BlunderPreview';
import { DemoProgressPanel } from './DemoProgressPanel';
import { DemoStatsCard } from './DemoStatsCard';
import { DemoPlanPreview } from './DemoPlanPreview';
import { trackCtaClick } from '../../services/funnelService';
import { useT } from '../../i18n/useT';

interface Props {
  demo: UseDemoAnalysisReturn;
}

export function DemoResult({ demo }: Props) {
  const t = useT();
  if (demo.status === 'idle') return null;

  if (demo.status === 'loading') {
    return (
      <div className="flex flex-col gap-3">
        <DemoProgressPanel label={demo.progressLabel || t('demo.starting')} />
        <p className="font-mono uppercase text-[10px] tracking-tight text-text-secondary">
          {t('demo.inBrowser')}
        </p>
      </div>
    );
  }

  if (demo.status === 'error') {
    const notFound = demo.error?.code === 'not-found';
    return (
      <div className="border-2 border-text-primary bg-surface p-6">
        <div className="font-mono uppercase text-xs tracking-tight text-gold-dark mb-2">
          {notFound ? t('demo.notFound') : t('demo.couldNotRun')}
        </div>
        <p className="text-text-primary mb-4">{demo.error?.message}</p>
        <button
          onClick={demo.reset}
          className="font-mono uppercase tracking-tight text-xs border-2 border-text-primary bg-transparent text-text-primary px-4 py-2 rounded-none hover:bg-text-primary hover:text-bg transition-colors"
        >
          {notFound ? t('demo.tryDifferent') : t('common.tryAgain')}
        </button>
      </div>
    );
  }

  const r = demo.result;
  if (!r) return null;

  const clean = demo.status === 'no-blunders';

  return (
    <div className="flex flex-col gap-6">
      {/* The plan names the opening from the board; the stats card skips the header guess. */}
      <DemoStatsCard
        gamesAnalyzed={r.gamesAnalyzed}
        blundersFound={clean ? 0 : r.blundersFound}
        biggestSwing={clean ? null : r.biggestSwing}
        eco={null}
        openingName={null}
      />
      <DemoPlanPreview result={r} />
      {!clean && r.blunder && (
        <BlunderPreview
          blunder={r.blunder}
          moveLabel={
            r.blunder.sideToMove === 'white'
              ? t('demo.moveLabelWhite', { move: r.blunder.moveNumber })
              : t('demo.moveLabelBlack', { move: r.blunder.moveNumber })
          }
        />
      )}
      <div
        className="flex flex-col sm:flex-row sm:items-center gap-4 sm:justify-between border-2 border-text-primary bg-text-primary text-bg p-6"
        data-testid="demo-plan-cta"
      >
        <div>
          <div className="font-mono uppercase tracking-tight text-sm sm:text-base">
            {clean ? t('demo.clean') : t('demo.blundersCost')}
          </div>
          <div className="font-sans text-bg text-sm mt-1">
            {clean ? t('demo.cleanBody') : t('demo.blundersBody')}
          </div>
        </div>
        <SignUpCta source={clean ? 'demo_clean' : 'demo_result'}>
          {t('landing.getPlan')} <span aria-hidden="true">→</span>
        </SignUpCta>
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
