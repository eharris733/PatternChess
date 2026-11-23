import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOpeningInsight, type OpeningInsightRow } from '../../hooks/useInsights';
import { OpeningRow, openingDisplayName } from '../insights/OpeningRow';
import { InsightCardSkeleton, Skeleton } from '../Skeleton';
import { MOTIF_LABEL, ALL_MOTIFS } from '../../chess/motifs';
import { GAME_STATE_LABEL, GAME_STATE_ORDER } from '../../chess/blunderContext';
import { PHASE_LABEL, PHASE_ORDER, type Blunder } from '../../models/blunder';
import { practiceAheadParams, type TrainingFocus } from '../../routes/training/trainingFocus';
import { useUpcomingBlunders } from '../../hooks/useUpcomingBlunders';
import { OpeningIcon } from '../icons/OpeningIcon';
import { EndgameIcon } from '../icons/EndgameIcon';
import { useLabel, useT } from '../../i18n/useT';
import type { MessageKey } from '../../i18n/i18n';

/**
 * What a focus tile offers: positions due now, practice ahead (nothing due,
 * some coming up), or nothing at all yet (the tile then leads to its page).
 */
type TileOffer = { kind: 'due'; count: number } | { kind: 'ahead' } | { kind: 'none' } | { kind: 'pending' };

/** One of the two big focus tiles: what's due, practice ahead, or "None yet". */
function FocusTile({
  icon,
  title,
  offer,
  onPick,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  offer: TileOffer;
  onPick: () => void;
  testId: string;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={offer.kind === 'pending'}
      data-testid={testId}
      data-offer={offer.kind}
      className="flex items-center gap-3 border-2 border-text-primary/20 px-4 py-3 text-left transition-colors hover:border-gold-dark hover:bg-gold-dark/10"
    >
      <span className="shrink-0 text-gold-dark">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-semibold text-text-primary">{title}</span>
        {offer.kind === 'pending' ? (
          <Skeleton className="mt-1 h-3 w-20" />
        ) : (
          <span className="text-xs text-text-primary">
            {offer.kind === 'due'
              ? t('landingTrain.due', { count: offer.count })
              : offer.kind === 'ahead'
                ? t('plan.practiceAhead')
                : t('landingTrain.noneYet')}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * The offer for one focus: due positions first; with none due, whether
 * practice ahead has anything (same query key /training uses for that focus,
 * so picking it starts instantly).
 */
function useTileOffer(focus: TrainingFocus, dueCount: number | null): TileOffer {
  const upcoming = useUpcomingBlunders(practiceAheadParams(focus), { enabled: dueCount === 0 });
  if (dueCount == null) return { kind: 'pending' };
  if (dueCount > 0) return { kind: 'due', count: dueCount };
  if (upcoming.isPending) return { kind: 'pending' };
  return (upcoming.data?.length ?? 0) > 0 ? { kind: 'ahead' } : { kind: 'none' };
}

const OPENINGS_FOCUS: TrainingFocus = { kindFilter: 'opening', returnTo: '/openings' };
const ENDGAMES_FOCUS: TrainingFocus = { phaseFilter: 'endgame', returnTo: '/endgames' };

const CONTEXT_LABEL: Record<'timeTrouble' | 'longThink', MessageKey> = {
  timeTrouble: 'train.timeTrouble',
  longThink: 'train.longThink',
};

// A row needs at least this many games before it's trustworthy enough to
// anchor a "weakest"/"strongest" ranking — otherwise a single loss/win swings it wildly.
const MIN_GAMES_FOR_RANKING = 3;

type OpeningTab = 'weakest' | 'strongest' | 'mostPlayed';

const OPENING_TABS: { key: OpeningTab; label: MessageKey }[] = [
  { key: 'weakest', label: 'landingTrain.weakest' },
  { key: 'strongest', label: 'landingTrain.strongest' },
  { key: 'mostPlayed', label: 'landingTrain.mostPlayed' },
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
  const t = useT();
  const [tab, setTab] = useState<OpeningTab>('weakest');
  const insight = useOpeningInsight();

  if (insight.isPending) return <InsightCardSkeleton rows={3} />;
  const rows = insight.data?.rows ?? [];
  const eligible = rows.filter((r) => r.games >= MIN_GAMES_FOR_RANKING);
  if (eligible.length === 0) {
    return (
      <p className="text-text-primary text-sm">
        {t('landingTrain.notEnough')}
      </p>
    );
  }

  const visible = sortRows(rows, tab);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1.5">
        {OPENING_TABS.map((ot) => (
          <button
            key={ot.key}
            type="button"
            onClick={() => setTab(ot.key)}
            className={`font-mono uppercase text-[10px] tracking-tight px-2 py-1 rounded-none border-2 transition-colors ${
              tab === ot.key
                ? 'bg-accent/15 border-accent text-text-primary'
                : 'border-text-primary text-text-primary hover:bg-accent/10'
            }`}
          >
            {t(ot.label)}
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
  const t = useT();
  const label = useLabel();
  const navigate = useNavigate();
  const dueCount = due?.length ?? 0;
  const openingsOffer = useTileOffer(OPENINGS_FOCUS, due ? due.filter((b) => b.kind === 'opening').length : null);
  const endgamesOffer = useTileOffer(ENDGAMES_FOCUS, due ? due.filter((b) => b.phase === 'endgame').length : null);
  // Due → review; coming up → practice ahead; nothing yet → the focus's own page.
  const pickTile = (focus: TrainingFocus, offer: TileOffer, home: '/openings' | '/endgames') => {
    if (offer.kind === 'none') navigate(home);
    else onPick({ ...focus, ...(offer.kind === 'ahead' ? { practiceAhead: true } : {}) });
  };
  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <div className="text-center flex flex-col gap-2">
        <h1 className="heading-lg">{t('landingTrain.title')}</h1>
        <p className="text-text-primary text-sm">
          {due && dueCount === 0
            ? t('landingTrain.nothingDue')
            : t('landingTrain.reviewOrFocus')}
        </p>
      </div>

      {due == null ? (
        <Skeleton className="h-14 w-full" />
      ) : dueCount > 0 ? (
        <button type="button" onClick={() => onPick({})} className="btn-primary w-full py-4 text-base">
          {t('landingTrain.review', { count: dueCount })}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onPick({ practiceAhead: true })}
          className="btn-primary w-full py-4 text-base"
        >
          {t('plan.practiceAhead')}
        </button>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FocusTile
          icon={<OpeningIcon className="h-5 w-5" />}
          title={t('nav.openings')}
          offer={openingsOffer}
          testId="focus-openings"
          onPick={() => pickTile(OPENINGS_FOCUS, openingsOffer, '/openings')}
        />
        <FocusTile
          icon={<EndgameIcon className="h-5 w-5" />}
          title={t('nav.endgames')}
          offer={endgamesOffer}
          testId="focus-endgames"
          onPick={() => pickTile(ENDGAMES_FOCUS, endgamesOffer, '/endgames')}
        />
      </div>

      <section className="card flex flex-col gap-3">
        <span className="label">{t('landingTrain.byOpening')}</span>
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
        <span className="label">{t('landingTrain.byPhase')}</span>
        <div className="flex flex-wrap gap-1.5">
          {PHASE_ORDER.map((phase) => (
            <button
              key={phase}
              type="button"
              onClick={() => onPick({ phaseFilter: phase })}
              className="font-mono uppercase text-[10px] tracking-tight px-2.5 py-1.5 rounded-none border-2 border-text-primary text-text-primary hover:bg-accent/10 transition-colors"
            >
              {label('phase', phase, PHASE_LABEL[phase])}
            </button>
          ))}
        </div>
      </section>

      <section className="card flex flex-col gap-3">
        <span className="label">{t('landingTrain.byPattern')}</span>
        <div className="flex flex-wrap gap-1.5">
          {ALL_MOTIFS.map((motif) => (
            <button
              key={motif}
              type="button"
              onClick={() => onPick({ motifFilter: motif })}
              className="font-mono uppercase text-[10px] tracking-tight px-2.5 py-1.5 rounded-none border-2 border-text-primary text-text-primary hover:bg-accent/10 transition-colors"
            >
              {label('motif', motif, MOTIF_LABEL[motif])}
            </button>
          ))}
        </div>
      </section>

      <section className="card flex flex-col gap-3">
        <span className="label">{t('landingTrain.bySituation')}</span>
        <div className="flex flex-wrap gap-1.5">
          {(['timeTrouble', 'longThink'] as const).map((ctx) => (
            <button
              key={ctx}
              type="button"
              onClick={() => onPick({ contextFilter: ctx })}
              className="font-mono uppercase text-[10px] tracking-tight px-2.5 py-1.5 rounded-none border-2 border-text-primary text-text-primary hover:bg-accent/10 transition-colors"
            >
              {t(CONTEXT_LABEL[ctx])}
            </button>
          ))}
          {GAME_STATE_ORDER.map((bucket) => (
            <button
              key={bucket}
              type="button"
              onClick={() => onPick({ contextFilter: bucket })}
              className="font-mono uppercase text-[10px] tracking-tight px-2.5 py-1.5 rounded-none border-2 border-text-primary text-text-primary hover:bg-accent/10 transition-colors"
            >
              {label('gameState', bucket, GAME_STATE_LABEL[bucket])}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
