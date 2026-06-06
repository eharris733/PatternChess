import { useState } from 'react';
import { SPACED_REPETITION_DAYS, SR_BUCKET_LABEL } from '../../models/blunder';
import { CheckIcon } from '../icons/CheckIcon';

// Shown once per device, then dismissed for good. localStorage (not a profile
// flag) keeps it instant and device-local, the same pattern as the theme store.
const SEEN_KEY = 'patternchess.seenTrainingIntro';

function hasSeenIntro(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

const STEPS = [
  {
    n: 1,
    title: 'Import your games',
    body: 'Connect Lichess or Chess.com — or upload PGNs — and we analyze them for the moves that cost you the most.',
  },
  {
    n: 2,
    title: 'Drill the positions',
    body: 'Each blunder becomes a puzzle: see the mistake you made, then find the move you should have played.',
  },
  {
    n: 3,
    title: 'Repeat on a schedule',
    body: `Recall a position and it returns later — after ${SPACED_REPETITION_DAYS.join(
      ', ',
    )} days — until it sticks. That's the woodpecker method.`,
  },
];

/**
 * A one-time "how it works" explainer for the dashboard: the woodpecker loop
 * (import → drill → spaced repeat) and what each position state means. Uses the
 * canonical SR_BUCKET_LABEL so the vocabulary matches the rest of the app.
 */
export function HowTrainingWorksCard() {
  const [dismissed, setDismissed] = useState(hasSeenIntro);

  if (dismissed) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // ignore — worst case it shows again next session
    }
    setDismissed(true);
  };

  return (
    <section className="card flex flex-col gap-4 border-gold-dark/60">
      <header className="flex items-baseline justify-between">
        <span className="label">How training works</span>
        <button
          type="button"
          className="font-mono text-xs uppercase tracking-tight text-text-secondary hover:text-text-primary"
          onClick={dismiss}
        >
          Dismiss
        </button>
      </header>

      <ol className="flex flex-col gap-3">
        {STEPS.map((s) => (
          <li key={s.n} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center border-2 border-text-primary bg-surface-3 font-mono text-xs text-gold-dark">
              {s.n}
            </span>
            <div>
              <p className="text-sm font-semibold text-text-primary">{s.title}</p>
              <p className="text-text-secondary text-sm">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-1.5 border-t-2 border-text-primary/15 pt-3">
        <span className="font-mono text-xs uppercase tracking-tight text-text-secondary">
          Position states
        </span>
        <p className="text-text-secondary text-sm">
          <span className="text-text-primary">{SR_BUCKET_LABEL.new}</span> — never drilled ·{' '}
          <span className="text-text-primary">{SR_BUCKET_LABEL.learning}</span> — climbing the ladder ·{' '}
          <span className="text-text-primary">{SR_BUCKET_LABEL.tryAgain}</span> — missed last time ·{' '}
          <span className="text-text-primary">{SR_BUCKET_LABEL.mastered}</span> — graduated every cycle
        </p>
      </div>

      <div>
        <button className="btn-primary inline-flex items-center gap-1.5" onClick={dismiss}>
          <CheckIcon className="h-4 w-4" />
          Got it
        </button>
      </div>
    </section>
  );
}
