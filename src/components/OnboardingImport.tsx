import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { supabaseService } from '../services/supabaseService';
import { useSyncStore } from '../state/syncStore';
import { useOnboardingStore } from '../state/onboardingStore';
import type { ProviderProgress } from '../services/syncService';
import { ProgressBar } from './ProgressBar';
import { BrandLockup } from './BrandLogo';
import { MiniBoard } from './MiniBoard';
import { CommitmentPicker } from './CommitmentPicker';
import { freshBlunderLine } from '../content/freshBlunderLines';
import { fetchingLine, summarizeFetch } from '../lib/syncProgress';

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
  // Live count while the sites send games: "Fetching games… 57 of 200 (3 months back)".
  const fetchSummary = summarizeFetch(active);

  const analyzeIndex = active.reduce((sum, p) => sum + p.analyzeGameIndex, 0);
  const analyzeTotal = active.reduce((sum, p) => sum + p.analyzeGamesTotal, 0);
  const blundersFound = active.reduce((sum, p) => sum + p.blundersFound, 0);

  const errorMsg = active.find((p) => p.error)?.error ?? null;

  // Preview the first trainable position as soon as analysis finds one, so
  // the first drill is one click away instead of after the whole import.
  // Polls while analysis runs (one row) until a position shows up.
  const hasBlunder = blundersFound >= 1;
  const firstQuery = useQuery({
    queryKey: ['blunders', 'onboardingFirst', profile?.id ?? null],
    queryFn: () => supabaseService.getFirstDueTactic(profile!.id),
    enabled: !!profile && hasBlunder,
    refetchInterval: (q) => (q.state.data ? false : 4000),
  });
  const first = firstQuery.data ?? null;

  const onContinue = () => {
    dismiss();
    // Non-null state skips the focus picker: straight into the due queue.
    navigate('/training', { state: {} });
  };

  const onEditProfile = () => {
    navigate('/profile');
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] max-w-xl mx-auto text-center">
      <BrandLockup size="lg" className="mb-4" />
      <p className="text-text-secondary mb-8">
        We're importing your last 200 games and finding the blunders you'll
        train against. Your first position is usually ready in a minute or two,
        and the rest keep arriving while you train.
      </p>

      {first && (
        <section
          className="w-full mb-6 bg-surface rounded-none p-6 border-2 border-text-primary shadow-card flex flex-col sm:flex-row gap-5 items-center text-left"
          data-testid="onboarding-first-position"
        >
          <MiniBoard
            fen={first.fen}
            orientation={first.sideToMove === 'black' ? 'black' : 'white'}
            className="w-40 shrink-0"
          />
          <div className="flex flex-col gap-3">
            <span className="label">Your first position is ready</span>
            <p className="text-text-primary">
              Move {first.moveNumber} of one of your games, {first.sideToMove === 'black' ? 'Black' : 'White'} to
              move. You missed something here. Can you find it now?
            </p>
            <button type="button" onClick={onContinue} className="btn-primary self-start">
              Solve it now
            </button>
          </div>
        </section>
      )}

      <div className="w-full space-y-6 bg-surface rounded-none p-6 border-2 border-text-primary shadow-card">
        <Step
          label="Importing games"
          done={phase === 'analyzing' || phase === 'done'}
          active={phase === 'fetching'}
          current={inserted || fetched}
          total={totalTarget || 200}
          hint={fetchSummary ? fetchingLine(fetchSummary) : null}
        />
        <Step
          label="Hunting for blunders"
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

      {phase === 'done' && blundersFound > 0 && (
        <p className="mt-6 w-full text-center text-text-primary" data-testid="onboarding-celebration">
          {freshBlunderLine(blundersFound, analyzeTotal, blundersFound)}
        </p>
      )}

      {phase === 'error' && (
        <div className="mt-6 w-full bg-incorrect/10 border-2 border-incorrect/50 text-incorrect rounded-none p-4 text-sm text-left">
          <div className="font-mono uppercase text-xs tracking-tight mb-1">Something went wrong</div>
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
          className="btn-outline"
        >
          Edit profile
        </button>
        {!first && (
          <button
            type="button"
            onClick={onContinue}
            disabled={phase !== 'done' && blundersFound < 1}
            className="btn-primary"
          >
            Start today's plan
          </button>
        )}
      </div>
      {phase === 'analyzing' && blundersFound >= 1 && (
        <p className="mt-3 text-xs text-text-secondary">
          More fuel on the way: we're still analyzing.
        </p>
      )}
      <p className="mt-3 text-xs text-text-secondary">
        New games sync automatically each time you visit — your vault stays
        current.
      </p>

      <section className="mt-8 w-full text-left" aria-labelledby="commitment-heading">
        <h2 id="commitment-heading" className="heading-md">How much will you commit each day?</h2>
        <p className="mt-1 mb-3 text-sm text-text-primary">
          Your daily plan follows this. Change it any time in your profile.
        </p>
        <CommitmentPicker compact />
      </section>
    </div>
  );
}

export function StepMarker({ done, active }: { done: boolean; active: boolean }) {
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
