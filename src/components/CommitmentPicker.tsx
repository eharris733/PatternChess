import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useAuth } from '../auth/useAuth';
import { supabaseService } from '../services/supabaseService';
import {
  COMMITMENT_LABEL,
  COMMITMENT_PRESETS,
  COMMITMENT_PRESET_ORDER,
  COMMITMENT_TAGLINE,
  DEFAULT_DAILY_GOALS,
  GAMES_PER_DAY_RANGE,
  POSITIONS_PER_DAY_RANGE,
  goalsFor,
  planSummary,
  type CommitmentLevel,
  type DailyGoals,
} from '../lib/dailyGoal';

/**
 * Pick a commitment level (preset or custom). Saves on every change
 * (optimistic; reverts on failure) — used on the onboarding import screen and
 * in /profile. All labels come from src/lib/dailyGoal.ts.
 */
export function CommitmentPicker({ compact = false }: { compact?: boolean }) {
  const { profile, refreshProfile } = useAuth();
  const stored = profile?.dailyGoals ?? DEFAULT_DAILY_GOALS;
  const [goals, setGoals] = useState<DailyGoals>(stored);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGoals(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored.level, stored.positionsPerDay, stored.gamesPerDay]);

  const save = (next: DailyGoals) => {
    const prev = goals;
    setGoals(next);
    setError(null);
    void supabaseService
      .updateDailyGoals(next)
      .then(() => refreshProfile())
      .catch((err) => {
        console.warn('[commitment] save failed', err);
        setGoals(prev);
        setError('Could not save your commitment. Try again in a moment.');
      });
  };

  // Custom numbers are drafted locally and saved on blur / Enter, so a field
  // can be cleared mid-edit without saving (and clamping) every keystroke.
  const [draft, setDraft] = useState({ positions: String(stored.positionsPerDay), games: String(stored.gamesPerDay) });
  useEffect(() => {
    setDraft({ positions: String(goals.positionsPerDay), games: String(goals.gamesPerDay) });
  }, [goals.positionsPerDay, goals.gamesPerDay]);
  const commitDraft = () => {
    const next = goalsFor('custom', {
      positionsPerDay: Number(draft.positions) || POSITIONS_PER_DAY_RANGE.min,
      gamesPerDay: Number(draft.games) || 0,
    });
    if (next.positionsPerDay !== goals.positionsPerDay || next.gamesPerDay !== goals.gamesPerDay) save(next);
    else setDraft({ positions: String(goals.positionsPerDay), games: String(goals.gamesPerDay) });
  };
  const onDraftKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
  };

  const pick = (level: CommitmentLevel) => {
    if (level === 'custom') save(goalsFor('custom', goals));
    else save(goalsFor(level));
  };

  return (
    <div className="flex flex-col gap-3" data-testid="commitment-picker">
      <div className={clsx('grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4')}>
        {COMMITMENT_PRESET_ORDER.map((level) => {
          const p = COMMITMENT_PRESETS[level];
          const active = goals.level === level;
          return (
            <button
              key={level}
              type="button"
              aria-pressed={active}
              onClick={() => pick(level)}
              className={clsx(
                'flex flex-col items-start gap-0.5 border-2 px-3 py-2 text-left transition-colors',
                active
                  ? 'border-gold-dark bg-gold-dark/10'
                  : 'border-text-primary/20 hover:border-text-primary/50',
              )}
            >
              <span className="text-sm font-semibold text-text-primary">{COMMITMENT_LABEL[level]}</span>
              <span className="text-xs text-text-primary">{planSummary(p)}</span>
              <span className="text-xs text-text-primary">{COMMITMENT_TAGLINE[level]}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          aria-pressed={goals.level === 'custom'}
          onClick={() => pick('custom')}
          className={clsx(
            'border-2 px-3 py-1.5 text-sm',
            goals.level === 'custom'
              ? 'border-gold-dark bg-gold-dark/10'
              : 'border-text-primary/20 hover:border-text-primary/50',
          )}
        >
          {COMMITMENT_LABEL.custom}
        </button>
        {goals.level === 'custom' && (
          <>
            <label className="flex items-center gap-2">
              <input
                type="number"
                className="input w-20"
                min={POSITIONS_PER_DAY_RANGE.min}
                max={POSITIONS_PER_DAY_RANGE.max}
                value={draft.positions}
                onChange={(e) => setDraft((d) => ({ ...d, positions: e.target.value }))}
                onBlur={commitDraft}
                onKeyDown={onDraftKey}
                aria-label="Positions per day"
              />
              positions
            </label>
            <label className="flex items-center gap-2">
              <input
                type="number"
                className="input w-20"
                min={GAMES_PER_DAY_RANGE.min}
                max={GAMES_PER_DAY_RANGE.max}
                value={draft.games}
                onChange={(e) => setDraft((d) => ({ ...d, games: e.target.value }))}
                onBlur={commitDraft}
                onKeyDown={onDraftKey}
                aria-label="Games per day"
              />
              games a day
            </label>
          </>
        )}
      </div>
      <p className="text-sm text-text-primary" data-testid="commitment-summary">
        Your day: {planSummary(goals)}.
      </p>
      <p className="text-xs text-text-primary">Smaller plans you actually finish beat big ones you skip.</p>
      {error && <p className="text-incorrect text-sm">{error}</p>}
    </div>
  );
}
