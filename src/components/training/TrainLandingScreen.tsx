import { useState } from 'react';
import { useOpeningInsight, type OpeningInsightRow } from '../../hooks/useInsights';
import { OpeningRow, openingDisplayName } from '../insights/OpeningRow';
import { InsightCardSkeleton, Skeleton } from '../Skeleton';
import { MOTIF_LABEL, ALL_MOTIFS } from '../../chess/motifs';
import { GAME_STATE_LABEL, GAME_STATE_ORDER } from '../../chess/blunderContext';
import { PHASE_LABEL, PHASE_ORDER, type Blunder } from '../../models/blunder';
import type { TrainingFocus } from '../../routes/training/trainingFocus';
import { OpeningIcon } from '../icons/OpeningIcon';
import { EndgameIcon } from '../icons/EndgameIcon';

/** One of the two big focus tiles: what's due, or practice ahead when nothing is. */
function FocusTile({
  icon,
  title,
  due,
  onPick,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  due: number;
  onPick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      data-testid={testId}
      className="flex items-center gap-3 border-2 border-text-primary/20 px-4 py-3 text-left transition-colors hover:border-gold-dark hover:bg-gold-dark/10"
    >
      <span className="shrink-0 text-gold-dark">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-semibold text-text-primary">{title}</span>
        <span className="text-xs text-text-primary">{due > 0 ? `${due} due` : 'Practice ahead'}</span>
      </span>
    </button>
  );
}

const CONTEXT_LABEL: Record<'timeTrouble' | 'longThink', string> = {
  timeTrouble: 'Time trouble',
  longThink: 'Long think',
};

// A row needs at least this many games before it's trustworthy enough to
// anchor a "weakest"/"strongest" ranking — otherwise a single loss/win swings it wildly.
const MIN_GAMES_FOR_RANKING = 3;

type OpeningTab = 'weakest' | 'strongest' | 'mostPlayed';

const OPENING_TABS: { key: OpeningTab; label: string }[] = [
  { key: 'weakest', label: 'Weakest' },
  { key: 'strongest', label: 'Strongest' },
  { key: 'mostPlayed', label: 'Most played' },
];

function sortRows(rows: OpeningInsightRow[], tab: OpeningTab): OpeningInsightRow[] {
  const eligible = rows.filter((r) => r.games >= MIN_GAMES_FOR_RANKING);
  const sorted = [...eligible];
  if (tab === 'weakest') sorted.sort((a, b) => a.winRate - b.winRate);
  else if (tab === 'strongest') sorted.sort((a, b) => b.winRate - a.winRate);
  else sorted.sort((a, b) => b.games - a.games);
  return sorted.slice(0, 8);
}

function OpeningPicker({ onPick }: { onPick: (row: OpeningInsightRow) => void }) {
  const [tab, setTab] = useState<OpeningTab>('weakest');
  const insight = useOpeningInsight();

  if (insight.isPending) return <InsightCardSkeleton rows={3} />;
  const rows = insight.data?.rows ?? [];
  const eligible = rows.filter((r) => r.games >= MIN_GAMES_FOR_RANKING);
  if (eligible.length === 0) {
    return (
      <p className="text-text-primary text-sm">
        Not enough games yet to rank your openings.
      </p>
    );
  }

  const visible = sortRows(rows, tab);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1.5">
        {OPENING_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`font-mono uppercase text-[10px] tracking-tight px-2 py-1 rounded-none border-2 transition-colors ${
              tab === t.key
                ? 'bg-accent/15 border-accent text-text-primary'
                : 'border-text-primary text-text-primary hover:bg-accent/10'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <ul className="flex flex-col divide-y divide-text-primary/15">
        {visible.map((row) => (
          <OpeningRow
            key={`${row.family}-${row.userColor ?? 'unknown'}`}
            row={row}
            onClick={() => onPick(row)}
          />
        ))}
      </ul>
    </div>
  );
}

export function TrainLandingScreen({
  due,
  onPick,
}: {
  /** The due queue (null while loading). */
  due: readonly Blunder[] | null;
  onPick: (filter: TrainingFocus) => void;
}) {
  const dueCount = due?.length ?? 0;
  const openingsDue = due?.filter((b) => b.kind === 'opening').length ?? 0;
  const endgamesDue = due?.filter((b) => b.phase === 'endgame').length ?? 0;
  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <div className="text-center flex flex-col gap-2">
        <h1 className="heading-lg">What do you want to train?</h1>
        <p className="text-text-primary text-sm">
          {due && dueCount === 0
            ? 'Nothing is due. Practice the positions coming up next, or pick a focus.'
            : "Review what's due, or pick a focus instead."}
        </p>
      </div>

      {due == null ? (
        <Skeleton className="h-14 w-full" />
      ) : dueCount > 0 ? (
        <button type="button" onClick={() => onPick({})} className="btn-primary w-full py-4 text-base">
          Review {dueCount} position{dueCount === 1 ? '' : 's'}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onPick({ practiceAhead: true })}
          className="btn-primary w-full py-4 text-base"
        >
          Practice ahead
        </button>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FocusTile
          icon={<OpeningIcon className="h-5 w-5" />}
          title="Openings"
          due={openingsDue}
          testId="focus-openings"
          onPick={() =>
            onPick({ kindFilter: 'opening', returnTo: '/openings', ...(openingsDue === 0 ? { practiceAhead: true } : {}) })
          }
        />
        <FocusTile
          icon={<EndgameIcon className="h-5 w-5" />}
          title="Endgames"
          due={endgamesDue}
          testId="focus-endgames"
          onPick={() =>
            onPick({ phaseFilter: 'endgame', returnTo: '/endgames', ...(endgamesDue === 0 ? { practiceAhead: true } : {}) })
          }
        />
      </div>

      <section className="card flex flex-col gap-3">
        <span className="label">By opening</span>
        <OpeningPicker
          onPick={(row) =>
            onPick({
              openingFilter: row.family,
              openingColor: row.userColor,
              openingLabel: openingDisplayName(row),
            })
          }
        />
      </section>

      <section className="card flex flex-col gap-3">
        <span className="label">By phase</span>
        <div className="flex flex-wrap gap-1.5">
          {PHASE_ORDER.map((phase) => (
            <button
              key={phase}
              type="button"
              onClick={() => onPick({ phaseFilter: phase })}
              className="font-mono uppercase text-[10px] tracking-tight px-2.5 py-1.5 rounded-none border-2 border-text-primary text-text-primary hover:bg-accent/10 transition-colors"
            >
              {PHASE_LABEL[phase]}
            </button>
          ))}
        </div>
      </section>

      <section className="card flex flex-col gap-3">
        <span className="label">By pattern</span>
        <div className="flex flex-wrap gap-1.5">
          {ALL_MOTIFS.map((motif) => (
            <button
              key={motif}
              type="button"
              onClick={() => onPick({ motifFilter: motif })}
              className="font-mono uppercase text-[10px] tracking-tight px-2.5 py-1.5 rounded-none border-2 border-text-primary text-text-primary hover:bg-accent/10 transition-colors"
            >
              {MOTIF_LABEL[motif]}
            </button>
          ))}
        </div>
      </section>

      <section className="card flex flex-col gap-3">
        <span className="label">By situation</span>
        <div className="flex flex-wrap gap-1.5">
          {(['timeTrouble', 'longThink'] as const).map((ctx) => (
            <button
              key={ctx}
              type="button"
              onClick={() => onPick({ contextFilter: ctx })}
              className="font-mono uppercase text-[10px] tracking-tight px-2.5 py-1.5 rounded-none border-2 border-text-primary text-text-primary hover:bg-accent/10 transition-colors"
            >
              {CONTEXT_LABEL[ctx]}
            </button>
          ))}
          {GAME_STATE_ORDER.map((bucket) => (
            <button
              key={bucket}
              type="button"
              onClick={() => onPick({ contextFilter: bucket })}
              className="font-mono uppercase text-[10px] tracking-tight px-2.5 py-1.5 rounded-none border-2 border-text-primary text-text-primary hover:bg-accent/10 transition-colors"
            >
              {GAME_STATE_LABEL[bucket]}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
