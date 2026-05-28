import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { useSyncStore } from '../state/syncStore';
import { useOnboardingStore } from '../state/onboardingStore';
import type { ProviderProgress } from '../services/syncService';
import { ProgressBar } from './ProgressBar';
import { BrandLockup } from './BrandLogo';

type Phase = 'fetching' | 'analyzing' | 'done' | 'error' | 'idle';

function combinedPhase(active: ProviderProgress[]): Phase {
  if (active.length === 0) return 'idle';
  const phases = active.map((p) => p.phase);
  if (phases.includes('error')) return 'error';
  if (phases.includes('fetching') || phases.includes('inserting')) return 'fetching';
  if (phases.includes('analyzing')) return 'analyzing';
  if (phases.every((p) => p === 'done')) return 'done';
  return 'idle';
}

export function OnboardingImport() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const providers = useSyncStore((s) => s.providers);
  const dismiss = useOnboardingStore((s) => s.dismiss);

  const active: ProviderProgress[] = [];
  if (profile?.lichessUsername) active.push(providers.lichess);
  if (profile?.chesscomUsername) active.push(providers.chesscom);

  const phase = combinedPhase(active);

  const fetched = active.reduce((sum, p) => sum + p.fetched, 0);
  const inserted = active.reduce((sum, p) => sum + p.inserted, 0);
  const totalTarget = active.reduce((sum, p) => sum + (p.total ?? 200), 0);

  const analyzeIndex = active.reduce((sum, p) => sum + p.analyzeGameIndex, 0);
  const analyzeTotal = active.reduce((sum, p) => sum + p.analyzeGamesTotal, 0);
  const blundersFound = active.reduce((sum, p) => sum + p.blundersFound, 0);

  const errorMsg = active.find((p) => p.error)?.error ?? null;

  const onContinue = () => {
    dismiss();
    navigate('/training');
  };

  const onEditProfile = () => {
    navigate('/profile');
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] max-w-xl mx-auto text-center">
      <BrandLockup size="lg" className="mb-4" />
      <p className="text-text-secondary mb-8">
        We're importing your last 200 games and finding the blunders you'll
        train against. This usually takes about five to ten minutes.
      </p>

      <div className="w-full space-y-6 bg-white rounded-none p-6 border-2 border-[#1A1A1A] shadow-[3px_3px_0_#1A1A1A]">
        <Step
          label="Importing games"
          done={phase === 'analyzing' || phase === 'done'}
          active={phase === 'fetching'}
          current={inserted || fetched}
          total={totalTarget || 200}
        />
        <Step
          label="Analyzing for blunders"
          done={phase === 'done'}
          active={phase === 'analyzing'}
          current={analyzeIndex}
          total={analyzeTotal || 200}
          hint={
            phase === 'analyzing' && blundersFound > 0
              ? `${blundersFound} blunder${blundersFound === 1 ? '' : 's'} found so far`
              : phase === 'done' && blundersFound > 0
                ? `${blundersFound} blunder${blundersFound === 1 ? '' : 's'} found`
                : null
          }
        />
      </div>

      {phase === 'error' && (
        <div className="mt-6 w-full bg-incorrect/10 border-2 border-incorrect/50 text-incorrect rounded-none p-4 text-sm text-left">
          <div className="font-mono uppercase text-xs tracking-tight mb-1">Something went wrong</div>
          <div className="text-text-secondary">{errorMsg ?? 'Sync failed.'}</div>
          <button
            type="button"
            onClick={onEditProfile}
            className="mt-3 text-[#1A1A1A] underline"
          >
            Check your profile
          </button>
        </div>
      )}

      <div className="mt-8 flex items-center gap-3">
        <button
          type="button"
          onClick={onEditProfile}
          className="btn-outline"
        >
          Edit profile
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={phase !== 'done' && blundersFound < 1}
          className="btn-primary"
        >
          Start training
        </button>
      </div>
      {phase === 'analyzing' && blundersFound >= 1 && (
        <p className="mt-3 text-xs text-text-secondary">
          More blunders will keep arriving as we finish analyzing.
        </p>
      )}
      <p className="mt-3 text-xs text-text-secondary">
        New games sync automatically each time you visit — your vault stays
        current.
      </p>
    </div>
  );
}

function StepMarker({ done, active }: { done: boolean; active: boolean }) {
  const cls = done ? 'text-correct' : active ? 'text-gold-dark' : 'text-text-secondary opacity-50';
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden
      className={cls}
    >
      {done ? (
        <path
          d="M5 12.5l4.5 4.5L19 7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : active ? (
        <circle cx="12" cy="12" r="6" fill="currentColor" />
      ) : (
        <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
      )}
    </svg>
  );
}

function Step({
  label,
  done,
  active,
  current,
  total,
  hint,
}: {
  label: string;
  done: boolean;
  active: boolean;
  current: number;
  total: number;
  hint?: string | null;
}) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <StepMarker done={done} active={active} />
        <span className="text-text-primary">{label}</span>
        {hint && <span className="text-xs text-text-secondary">· {hint}</span>}
      </div>
      <ProgressBar current={done ? total : current} total={total} />
    </div>
  );
}
