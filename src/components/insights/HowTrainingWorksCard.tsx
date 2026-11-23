import { useState } from 'react';
import { MASTERED_REVIEW_DAYS, SPACED_REPETITION_DAYS, SR_BUCKET_LABEL } from '../../models/blunder';
import { CheckIcon } from '../icons/CheckIcon';
import { ChevronIcon } from '../icons/ChevronIcon';
import { useLabel, useT } from '../../i18n/useT';

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

// Step copy lives in the i18n catalogs (`how2.<n>.title` / `how2.<n>.body`).
const STEPS = [1, 2, 3] as const;

/**
 * A one-time "how it works" explainer for the dashboard: the woodpecker loop
 * (import → drill → spaced repeat) and what each position state means. Uses the
 * canonical SR_BUCKET_LABEL so the vocabulary matches the rest of the app.
 */
export function HowTrainingWorksCard() {
  const t = useT();
  const label = useLabel();
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
        {t('how2.showAgain')}
      </button>
    );
  }

  return (
    <section className="card flex flex-col gap-4 border-gold-dark/60">
      <span className="label">{t('how2.title')}</span>

      <ol className="flex flex-col gap-3">
        {STEPS.map((n) => (
          <li key={n} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center border-2 border-text-primary bg-surface-3 font-mono text-xs text-gold-dark">
              {n}
            </span>
            <div>
              <p className="text-sm font-semibold text-text-primary">{t(`how2.${n}.title` as 'how2.1.title')}</p>
              <p className="text-text-primary text-sm">
                {n === 2
                  ? t('how2.2.body', {
                      days: SPACED_REPETITION_DAYS.slice(0, -1).join(', '),
                      last: SPACED_REPETITION_DAYS[SPACED_REPETITION_DAYS.length - 1],
                      mastered: MASTERED_REVIEW_DAYS,
                    })
                  : t(`how2.${n}.body` as 'how2.1.body')}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-1.5 border-t-2 border-text-primary/15 pt-3">
        <span className="label">{t('how2.states')}</span>
        <p className="text-text-primary text-sm">
          {t.rich('how2.statesBody', {
            new: <span className="font-semibold">{label('srBucket', 'new', SR_BUCKET_LABEL.new)}</span>,
            learning: <span className="font-semibold">{label('srBucket', 'learning', SR_BUCKET_LABEL.learning)}</span>,
            tryAgain: <span className="font-semibold">{label('srBucket', 'tryAgain', SR_BUCKET_LABEL.tryAgain)}</span>,
            mastered: <span className="font-semibold">{label('srBucket', 'mastered', SR_BUCKET_LABEL.mastered)}</span>,
            count: SPACED_REPETITION_DAYS.length,
          })}
        </p>
      </div>

      <div>
        <button className="btn-primary inline-flex items-center gap-1.5" onClick={dismiss}>
          <CheckIcon className="h-4 w-4" />
          {t('how2.gotIt')}
        </button>
      </div>
    </section>
  );
}
