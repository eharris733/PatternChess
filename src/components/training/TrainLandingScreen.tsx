import { useState } from 'react';
import { useOpeningInsight, type OpeningInsightRow } from '../../hooks/useInsights';
import { OpeningRow, openingDisplayName } from '../insights/OpeningRow';
import { InsightCardSkeleton } from '../Skeleton';
import { MOTIF_LABEL, ALL_MOTIFS, type Motif } from '../../chess/motifs';
import { GAME_STATE_LABEL, GAME_STATE_ORDER, type ContextFilter } from '../../chess/blunderContext';
import { PHASE_LABEL, PHASE_ORDER, type BlunderPhase } from '../../models/blunder';

export interface TrainFilterPick {
  contextFilter?: ContextFilter;
  phaseFilter?: BlunderPhase;
  motifFilter?: Motif;
  openingFilter?: string;
  openingColor?: 'white' | 'black' | null;
  openingLabel?: string;
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
      <p className="text-text-secondary text-sm">
        Not enough played games yet to rank openings — sync more games or train everything for now.
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
                : 'border-text-primary text-text-secondary hover:bg-accent/10'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <ul className="flex flex-col divide-y divide-text-primary/15">
        {visible.map((row) => (
          <OpeningRow
            key={`${row.ecoFamily}-${row.userColor ?? 'unknown'}`}
            row={row}
            onClick={() => onPick(row)}
          />
        ))}
      </ul>
    </div>
  );
}

export function TrainLandingScreen({
  dueCount,
  onPick,
}: {
  dueCount: number;
  onPick: (filter: TrainFilterPick) => void;
}) {
  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <div className="text-center flex flex-col gap-2">
        <h1 className="heading-lg">What do you want to train?</h1>
        <p className="text-text-secondary text-sm">
          Review what's due, or pick a focus instead.
        </p>
      </div>

      <button type="button" onClick={() => onPick({})} className="btn-primary w-full py-4 text-base">
        Review {dueCount} position{dueCount === 1 ? '' : 's'}
      </button>

      <section className="card flex flex-col gap-3">
        <span className="label">By opening</span>
        <OpeningPicker
          onPick={(row) =>
            onPick({
              openingFilter: row.ecoFamily,
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
              className="font-mono uppercase text-[10px] tracking-tight px-2.5 py-1.5 rounded-none border-2 border-text-primary text-text-secondary hover:bg-accent/10 transition-colors"
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
              className="font-mono uppercase text-[10px] tracking-tight px-2.5 py-1.5 rounded-none border-2 border-text-primary text-text-secondary hover:bg-accent/10 transition-colors"
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
              className="font-mono uppercase text-[10px] tracking-tight px-2.5 py-1.5 rounded-none border-2 border-text-primary text-text-secondary hover:bg-accent/10 transition-colors"
            >
              {CONTEXT_LABEL[ctx]}
            </button>
          ))}
          {GAME_STATE_ORDER.map((bucket) => (
            <button
              key={bucket}
              type="button"
              onClick={() => onPick({ contextFilter: bucket })}
              className="font-mono uppercase text-[10px] tracking-tight px-2.5 py-1.5 rounded-none border-2 border-text-primary text-text-secondary hover:bg-accent/10 transition-colors"
            >
              {GAME_STATE_LABEL[bucket]}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
