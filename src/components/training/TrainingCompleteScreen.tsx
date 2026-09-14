import { TrophyIcon } from '../icons/TrophyIcon';

/** The "Cycle complete" summary shown when a training session finishes. */
export function TrainingCompleteScreen({
  totalCorrect,
  totalAttempted,
  onKeepTraining,
  onBackToDashboard,
}: {
  totalCorrect: number;
  totalAttempted: number;
  onKeepTraining: () => void;
  onBackToDashboard: () => void;
}) {
  const pct = totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : 0;
  return (
    <div className="max-w-md mx-auto card text-center flex flex-col gap-4">
      <TrophyIcon className="h-14 w-14 self-center text-gold-dark" />
      <h1 className="heading-lg">Cycle complete</h1>
      <p className="text-text-secondary">
        {pct}% recall · {totalCorrect}/{totalAttempted} correct
      </p>
      <button className="btn-primary" onClick={onKeepTraining}>
        Keep training
      </button>
      <button className="btn-outline" onClick={onBackToDashboard}>
        Back to dashboard
      </button>
    </div>
  );
}
