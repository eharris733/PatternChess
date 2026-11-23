import { useState } from 'react';
import { MASTERED_REVIEW_DAYS, SPACED_REPETITION_DAYS, SR_BUCKET_LABEL } from '../../models/blunder';
import { CheckIcon } from '../icons/CheckIcon';
import { ChevronIcon } from '../icons/ChevronIcon';

// Open by default until dismissed; after that it collapses to a one-line
// disclosure instead of vanishing. localStorage (not a profile flag) keeps it
// instant and device-local, the same pattern as the theme store.
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
    title: 'Drill your blunders',
    body: 'Each blunder from your games becomes a puzzle: find the move you should have played.',
  },
  {
    n: 2,
    title: 'Repeat on a schedule',
    body: `Solve a position and it comes back after ${SPACED_REPETITION_DAYS.slice(0, -1).join(
      ', ',
    )}, then ${SPACED_REPETITION_DAYS[SPACED_REPETITION_DAYS.length - 1]} days, then every ${MASTERED_REVIEW_DAYS} days to stay sharp.`,
  },
  {
    n: 3,
    title: 'Show up daily',
    body: 'Your plan resets every day. Finish it to keep your streak.',
  },
];

/**
 * A one-time "how it works" explainer for the dashboard: the woodpecker loop
 * (import → drill → spaced repeat) and what each position state means. Uses the
 * canonical SR_BUCKET_LABEL so the vocabulary matches the rest of the app.
 */
export function HowTrainingWorksCard() {
  const [dismissed, setDismissed] = useState(hasSeenIntro);
  const [reopened, setReopened] = useState(false);

  const dismiss = () => {
    try {
      window.localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // ignore — worst case it shows again next session
    }
    setDismissed(true);
    setReopened(false);
  };

  if (dismissed && !reopened) {
    return (
      <button
        type="button"
        className="flex items-center gap-2 text-xs font-semibold text-text-primary hover:underline self-start"
        onClick={() => setReopened(true)}
        aria-expanded={false}
      >
        <ChevronIcon className="h-3 w-3" />
        Show the training explainer
      </button>
    );
  }

  return (
    <section className="card flex flex-col gap-4 border-gold-dark/60">
      <span className="label">How training works</span>

      <ol className="flex flex-col gap-3">
        {STEPS.map((s) => (
          <li key={s.n} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center border-2 border-text-primary bg-surface-3 font-mono text-xs text-gold-dark">
              {s.n}
            </span>
            <div>
              <p className="text-sm font-semibold text-text-primary">{s.title}</p>
              <p className="text-text-primary text-sm">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-1.5 border-t-2 border-text-primary/15 pt-3">
        <span className="label">Position states</span>
        <p className="text-text-primary text-sm">
          <span className="font-semibold">{SR_BUCKET_LABEL.new}</span>: never drilled ·{' '}
          <span className="font-semibold">{SR_BUCKET_LABEL.learning}</span>: climbing the ladder ·{' '}
          <span className="font-semibold">{SR_BUCKET_LABEL.tryAgain}</span>: missed last time ·{' '}
          <span className="font-semibold">{SR_BUCKET_LABEL.mastered}</span>: passed all {SPACED_REPETITION_DAYS.length} spaced reviews
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
