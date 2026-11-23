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
  FREE_MAX_POSITIONS,
  goalsFor,
  needsSupporter,
  planSummaryParts,
  type CommitmentLevel,
  type DailyGoals,
} from '../lib/dailyGoal';
import { useLabel, useT, type Translator } from '../i18n/useT';
import { useSupporter } from '../hooks/useSupporter';
import { openSupporterUnlock } from '../state/supporterUnlockStore';
import { LockIcon } from './icons/LockIcon';

function summary(goals: Pick<DailyGoals, 'positionsPerDay' | 'gamesPerDay'>, t: Translator): string {
  return planSummaryParts(goals)
    .map((p) => t(`commitment.unit.${p.unit}`, { count: p.count }))
    .join(', ');
}

/**
 * Pick a commitment level (preset or custom). Saves on every change
 * (optimistic; reverts on failure) — used on the onboarding import screen and
 * in /profile. All labels come from src/lib/dailyGoal.ts.
 */
export function CommitmentPicker({ compact = false }: { compact?: boolean }) {
  const { profile, refreshProfile } = useAuth();
  const t = useT();
  const label = useLabel();
  const { isSupporter, isPending: supporterPending } = useSupporter();
  // Obsessed and custom goals past 20 are Supporter plans (dailyGoal.ts).
  const locked = (g: Pick<DailyGoals, 'level' | 'positionsPerDay'>) => !supporterPending && !isSupporter && needsSupporter(g);
  const maxPositions = isSupporter ? POSITIONS_PER_DAY_RANGE.max : FREE_MAX_POSITIONS;
  const askToUnlock = (level: CommitmentLevel) =>
    openSupporterUnlock({
      item: t('commitment.supporterPlan', { name: label('commitment', level, COMMITMENT_LABEL[level]) }),
      earnHint: t('commitment.freeMax', { count: FREE_MAX_POSITIONS }),
    });
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
        setError(t('commitment.saveError'));
      });
  };

  // Custom numbers are drafted locally and saved on blur / Enter, so a field
  // can be cleared mid-edit without saving (and clamping) every keystroke.
  const [draft, setDraft] = useState({ positions: String(stored.positionsPerDay), games: String(stored.gamesPerDay) });
  useEffect(() => {
    setDraft({ positions: String(goals.positionsPerDay), games: String(goals.gamesPerDay) });
  }, [goals.positionsPerDay, goals.gamesPerDay]);
  const commitDraft = () => {
    const wanted = goalsFor('custom', {
      positionsPerDay: Number(draft.positions) || POSITIONS_PER_DAY_RANGE.min,
      gamesPerDay: Number(draft.games) || 0,
    });
    if (locked(wanted)) askToUnlock('custom');
    const next = { ...wanted, positionsPerDay: Math.min(wanted.positionsPerDay, maxPositions) };
    if (next.positionsPerDay !== goals.positionsPerDay || next.gamesPerDay !== goals.gamesPerDay) save(next);
    else setDraft({ positions: String(goals.positionsPerDay), games: String(goals.gamesPerDay) });
  };
  const onDraftKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
  };

  const pick = (level: CommitmentLevel) => {
    if (level === 'custom') {
      save(goalsFor('custom', { ...goals, positionsPerDay: Math.min(goals.positionsPerDay, maxPositions) }));
      return;
    }
    const next = goalsFor(level);
    if (locked(next)) askToUnlock(level);
    else save(next);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="commitment-picker">
      <div className={clsx('grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4')}>
        {COMMITMENT_PRESET_ORDER.map((level) => {
          const p = COMMITMENT_PRESETS[level];
          const active = goals.level === level;
          const isLocked = !active && locked({ level, positionsPerDay: p.positionsPerDay });
          return (
            <button
              key={level}
              type="button"
              aria-pressed={active}
              data-testid={`commitment-${level}`}
              data-locked={isLocked || undefined}
              onClick={() => pick(level)}
              className={clsx(
                'flex flex-col items-start gap-0.5 border-2 px-3 py-2 text-left transition-colors',
                active
                  ? 'border-gold-dark bg-gold-dark/10'
                  : 'border-text-primary/20 hover:border-text-primary/50',
              )}
            >
              <span className="flex items-center gap-1 text-sm font-semibold text-text-primary">
                {isLocked && <LockIcon className="h-3.5 w-3.5" />}
                {label('commitment', level, COMMITMENT_LABEL[level])}
              </span>
              <span className="text-xs text-text-primary">{summary(p, t)}</span>
              <span className="text-xs text-text-primary">{label('commitmentTagline', level, COMMITMENT_TAGLINE[level])}</span>
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
          {label('commitment', 'custom', COMMITMENT_LABEL.custom)}
        </button>
        {goals.level === 'custom' && (
          <>
            <label className="flex items-center gap-2">
              <input
                type="number"
                className="input w-20"
                min={POSITIONS_PER_DAY_RANGE.min}
                max={maxPositions}
                value={draft.positions}
                onChange={(e) => setDraft((d) => ({ ...d, positions: e.target.value }))}
                onBlur={commitDraft}
                onKeyDown={onDraftKey}
                aria-label={t('commitment.positionsPerDay')}
              />
              {t('commitment.positions')}
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
                aria-label={t('commitment.gamesPerDay')}
              />
              {t('commitment.gamesADay')}
            </label>
          </>
        )}
      </div>
      <p className="text-sm text-text-primary" data-testid="commitment-summary">
        {t('commitment.yourDay', { summary: summary(goals, t) })}
      </p>
      <p className="text-xs text-text-primary">{t('commitment.smallerPlans')}</p>
      {error && <p className="text-incorrect text-sm">{error}</p>}
    </div>
  );
}
