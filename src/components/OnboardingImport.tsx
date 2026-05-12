import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { useSyncStore } from '../state/syncStore';
import { useOnboardingStore } from '../state/onboardingStore';
import type { ProviderProgress } from '../services/syncService';
import { ProgressBar } from './ProgressBar';

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
      <h1 className="text-3xl font-semibold mb-2">Welcome to PatternChess</h1>
      <p className="text-text-secondary mb-8">
        We're importing your last 200 games and finding the blunders you'll
        train against. This usually takes about five to ten minutes.
      </p>

      <div className="w-full space-y-6 bg-surface rounded-xl p-6 border border-surface-2">
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
        <div className="mt-6 w-full bg-incorrect/10 border border-incorrect/40 text-incorrect rounded-lg p-4 text-sm text-left">
          <div className="font-medium mb-1">Something went wrong</div>
          <div className="text-text-secondary">{errorMsg ?? 'Sync failed.'}</div>
          <button
            type="button"
            onClick={onEditProfile}
            className="mt-3 text-text-primary underline"
          >
            Check your profile
          </button>
        </div>
      )}

      <div className="mt-8 flex items-center gap-3">
        <button
          type="button"
          onClick={onEditProfile}
          className="px-4 py-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-2 transition"
        >
          Edit profile
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={phase !== 'done' && blundersFound < 1}
          className="px-5 py-2 rounded-lg bg-accent text-bg font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition"
        >
          Start training
        </button>
      </div>
      {phase === 'analyzing' && blundersFound >= 1 && (
        <p className="mt-3 text-xs text-text-secondary">
          More blunders will keep arriving as we finish analyzing.
        </p>
      )}
    </div>
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
        <span
          className={
            done
              ? 'text-correct'
              : active
                ? 'text-accent'
                : 'text-text-secondary opacity-50'
          }
        >
          {done ? '✓' : active ? '●' : '○'}
        </span>
        <span className="text-text-primary">{label}</span>
        {hint && <span className="text-xs text-text-secondary">· {hint}</span>}
      </div>
      <ProgressBar current={done ? total : current} total={total} />
    </div>
  );
}
