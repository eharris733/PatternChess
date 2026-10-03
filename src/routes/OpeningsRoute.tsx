import { useEffect, useMemo, useState } from 'react';
import { playersHeading } from '../components/openings/TheoryMovesLine';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import type { DrawShape } from 'chessground/draw';
import { Skeleton } from '../components/Skeleton';
import { BoardPanel } from '../components/BoardPanel';
import { MasteryDots } from '../components/MasteryDots';
import { DeviationCard, moveLabel } from '../components/openings/DeviationCard';
import {
  costlyExitGames,
  headlineOpening,
  trainableLeaks,
  typicalExitMove,
  type DeviationLeak,
  type OpeningSummary,
} from '../chess/openingDeviation';
import { CASTLING_NORMALIZE, isUciMove, parseUciMove, toKey } from '../chess/moveUtils';
import { formatOpeningDisplay } from '../chess/openingNames';
import { useOpeningDeviations } from '../hooks/useOpeningDeviations';
import { isDue, useDrillsOfKind } from '../hooks/useDrillsOfKind';
import { useRepertoire } from '../hooks/useRepertoire';
import { useAuth } from '../auth/useAuth';
import { recordOpeningReview } from '../lib/openingReviews';
import { studiesForOpening } from '../learn/catalog';
import { srBucket, type Blunder } from '../models/blunder';
import { repertoireMoveFor, type RepertoireMap } from '../models/repertoire';
import {
  startOpeningDeviationScan,
  type DeviationScanProgress,
} from '../services/openingDeviationService';

type ColorTab = 'all' | 'white' | 'black';

const COLOR_TABS: Array<[ColorTab, string]> = [
  ['all', 'All'],
  ['white', 'As White'],
  ['black', 'As Black'],
];

const LEAKS_SHOWN = 5;

function familyName(s: OpeningSummary): string {
  return formatOpeningDisplay({ name: s.family, eco: null }) ?? s.family;
}

function colorName(c: 'white' | 'black'): string {
  return c === 'white' ? 'White' : 'Black';
}

/** Small square in the side's colour — the chess way to say "as White/Black". */
function SideSwatch({ color }: { color: 'white' | 'black' }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'inline-block h-3.5 w-3.5 shrink-0 border-2 border-text-primary',
        color === 'white' ? 'bg-[#ffffff]' : 'bg-[#1a1a1a]',
      )}
    />
  );
}

/** Arrow for a UCI move; none for a malformed one (it would draw at NaN). */
function arrow(uci: string, brush: string): DrawShape[] {
  if (!isUciMove(uci)) return [];
  const m = parseUciMove(uci);
  return [{ orig: toKey(m.from), dest: toKey(m.to), brush }];
}

/** Drill rows for the summary's leaks that are still live (not retired). */
function drillsFor(leaks: DeviationLeak[], drills: Map<string, Blunder> | undefined): Blunder[] {
  if (!drills) return [];
  const out: Blunder[] = [];
  const seen = new Set<string>();
  for (const l of leaks) {
    const d = l.blunderId ? drills.get(l.blunderId) : undefined;
    if (d && !seen.has(d.id)) {
      seen.add(d.id);
      out.push(d);
    }
  }
  return out;
}

/** The user's saved move at this leak's position, when it differs from what they played. */
function repertoireNote(leak: DeviationLeak, color: 'white' | 'black', rep: RepertoireMap | undefined) {
  const saved = repertoireMoveFor(rep, color, leak.fenBefore);
  if (!saved) return null;
  const norm = (u: string) => CASTLING_NORMALIZE[u] ?? u;
  return norm(saved.uci) === norm(leak.playedUci) ? null : saved;
}

/** "Your biggest opening leak": the aha moment, with one button to start fixing it. */
function OpeningsHero({
  summary,
  drills,
  onDrill,
}: {
  summary: OpeningSummary;
  drills: Blunder[];
  onDrill: () => void;
}) {
  const costly = trainableLeaks(summary).filter((l) => l.avgChancesLost != null);
  const top = [...costly].sort((a, b) => b.count - a.count || b.score - a.score)[0];
  const games = costlyExitGames(summary);
  const exitMove = typicalExitMove(summary);
  const shapes = useMemo(
    () =>
      top
        ? [...top.theoryMoves.slice(0, 2).flatMap((t) => arrow(t.uci, 'green')), ...arrow(top.playedUci, 'red')]
        : [],
    [top],
  );
  if (!top) return null;
  const main = top.theoryMoves[0];

  return (
    <section className="card flex flex-col sm:flex-row gap-5" data-testid="openings-hero">
      <div className="w-full sm:w-56 shrink-0">
        <BoardPanel
          fen={top.fenBefore}
          orientation={summary.color}
          movableFor={null}
          shapes={shapes}
          viewOnly
          coordinates={false}
          sounds={false}
        />
      </div>
      <div className="flex flex-col gap-3 min-w-0">
        <span className="label">Your biggest opening leak</span>
        <h2 className="heading-lg">
          {familyName(summary)} as {colorName(summary.color)}: you left theory
          {exitMove != null ? ` by move ${exitMove}` : ''} in {games} {games === 1 ? 'game' : 'games'}.
        </h2>
        <p className="text-text-primary">
          Most repeated:{' '}
          <span className="font-mono font-semibold text-incorrect">
            {moveLabel(top.fenBefore, top.moveNumber, top.playedSan)}
          </span>
          {top.count > 1 ? ` in ${top.count} games` : ''}.
          {main && (
            <>
              {' '}
              {playersHeading(main.tier)}{' '}
              <span className="font-mono font-semibold text-correct">{main.san}</span>
              {main.games > 0 ? ` ${Math.round(main.share)}% of the time` : ''}.
            </>
          )}
        </p>
        {drills.length > 0 && (
          <button
            type="button"
            className="btn-primary self-start mt-auto"
            onClick={onDrill}
            data-testid="hero-drill"
          >
            Drill {drills.length === 1 ? 'this position' : `these ${drills.length} positions`}
          </button>
        )}
      </div>
    </section>
  );
}

function OpeningPatternCard({
  summary,
  expanded,
  onToggle,
  drillMap,
  repertoire,
  onDrill,
}: {
  summary: OpeningSummary;
  expanded: boolean;
  onToggle: () => void;
  drillMap: Map<string, Blunder> | undefined;
  repertoire: RepertoireMap | undefined;
  onDrill: (ids: string[], label: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const trainable = trainableLeaks(summary);
  const leaks = showAll ? summary.leaks : trainable;
  const drills = drillsFor(trainable, drillMap);
  const mastered = drills.filter((d) => srBucket(d) === 'mastered').length;
  const due = drills.filter((d) => isDue(d)).length;
  const costlyGames = costlyExitGames(summary);
  const exitMove = typicalExitMove(summary);
  const studies = studiesForOpening(summary.family, summary.color);
  const name = familyName(summary);
  const hiddenSound = summary.leaks.length - trainable.length;

  return (
    <section className="card !p-0" data-testid="opening-section">
      <div className="flex items-center gap-3 p-4 sm:p-5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex-1 min-w-0 text-left flex flex-col gap-1 hover:opacity-80 transition-opacity"
        >
          <span className="flex items-center gap-2">
            <SideSwatch color={summary.color} />
            <h2 className="heading-md truncate">{name}</h2>
          </span>
          <span className="text-text-primary text-sm">
            {costlyGames > 0
              ? `Left theory in ${costlyGames} of ${summary.games} ${summary.games === 1 ? 'game' : 'games'}${
                  exitMove != null ? `, usually by move ${exitMove}` : ''
                }`
              : `${summary.games} ${summary.games === 1 ? 'game' : 'games'}, no costly exits`}
          </span>
          {drills.length > 0 && (
            <span className="flex items-center gap-2 text-sm text-text-primary" data-testid="opening-mastery">
              <MasteryDots
                cycleNumber={Math.round(drills.reduce((n, d) => n + Math.min(d.cycleNumber, 4), 0) / drills.length)}
                size="sm"
              />
              <span className="font-semibold">
                {mastered}/{drills.length} mastered
              </span>
              {due > 0 && <span className="font-semibold text-gold-dark">· {due} due</span>}
            </span>
          )}
        </button>
        {drills.length > 0 && (
          <button
            type="button"
            className="btn-outline text-sm shrink-0"
            data-testid="drill-opening"
            onClick={() => onDrill(drills.map((d) => d.id), name)}
          >
            Drill {drills.length}
          </button>
        )}
      </div>

      {expanded && (
        <div className="border-t-2 border-text-primary/20 p-4 sm:p-5 flex flex-col gap-4">
          {leaks.length === 0 ? (
            <p className="text-text-primary text-sm">
              {summary.pendingEvals > 0
                ? 'Still checking your exits from this opening with the engine.'
                : summary.userLeft === 0
                  ? 'You never left theory first in this opening.'
                  : 'Every time you left theory here, your move held up.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {leaks.slice(0, LEAKS_SHOWN).map((leak) => (
                <DeviationCard
                  key={leak.key}
                  leak={leak}
                  color={summary.color}
                  openingLabel={name}
                  drill={leak.blunderId ? (drillMap?.get(leak.blunderId) ?? null) : null}
                  repertoireMove={repertoireNote(leak, summary.color, repertoire)}
                />
              ))}
            </ul>
          )}
          {hiddenSound > 0 && (
            <button
              type="button"
              className="self-start text-sm font-semibold text-text-primary underline hover:no-underline"
              onClick={() => setShowAll((v) => !v)}
              data-testid="toggle-all-exits"
            >
              {showAll
                ? 'Hide exits that held up'
                : `Show ${hiddenSound} ${hiddenSound === 1 ? 'exit' : 'exits'} that held up`}
            </button>
          )}

          {studies.length > 0 && (
            <div className="flex flex-col gap-2" data-testid="suggested-studies">
              <span className="label">Suggested studies</span>
              <ul className="flex flex-wrap gap-2">
                {studies.map((s) => (
                  <li key={s.slug}>
                    <Link to={`/learn/${s.slug}`} className="pill">
                      {s.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function OpeningsRoute() {
  const { refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const colorParam = params.get('color');
  const color: ColorTab = colorParam === 'white' || colorParam === 'black' ? colorParam : 'all';
  const setColor = (next: ColorTab) => {
    const p = new URLSearchParams(params);
    if (next === 'all') p.delete('color');
    else p.set('color', next);
    setParams(p, { replace: true });
  };

  const [progress, setProgress] = useState<DeviationScanProgress | null>(null);
  useEffect(() => startOpeningDeviationScan(setProgress), []);

  const [expanded, setExpanded] = useState<string | null>(null);
  const query = useOpeningDeviations();
  const drillsQuery = useDrillsOfKind('opening');
  const repertoire = useRepertoire();

  const summaries = useMemo(
    () => (query.data ?? []).filter((s) => color === 'all' || s.color === color),
    [query.data, color],
  );
  const hero = useMemo(() => headlineOpening(summaries), [summaries]);
  const heroDrills = useMemo(
    () => (hero ? drillsFor(trainableLeaks(hero), drillsQuery.data) : []),
    [hero, drillsQuery.data],
  );
  const firstKey = summaries[0] ? `${summaries[0].family}|${summaries[0].color}` : null;
  const openKey = expanded ?? firstKey;

  const allDrills = useMemo(() => [...(drillsQuery.data?.values() ?? [])], [drillsQuery.data]);
  const dueCount = allDrills.filter((d) => isDue(d)).length;
  const masteredCount = allDrills.filter((d) => srBucket(d) === 'mastered').length;

  const countReview = () => recordOpeningReview(() => void refreshProfile());
  const drill = (ids: string[], label: string) => {
    countReview();
    navigate('/training', { state: { blunderIds: ids, focusLabel: label } });
  };

  const left = progress ? progress.unwalked + progress.unscored + progress.pastBook : 0;
  const scanning = left > 0 && !!progress?.active;

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="label">Openings</span>
          <h1 className="heading-xl">Where you leave theory</h1>
          {allDrills.length > 0 && (
            <p className="text-text-primary text-sm" data-testid="openings-stats">
              {allDrills.length} {allDrills.length === 1 ? 'position' : 'positions'} in training ·{' '}
              {masteredCount} mastered
            </p>
          )}
        </div>
        {dueCount > 0 && (
          <button
            type="button"
            className="btn-primary"
            data-testid="review-due"
            onClick={() => {
              countReview();
              navigate('/training', { state: { kindFilter: 'opening' } });
            }}
          >
            Review {dueCount} due
          </button>
        )}
      </header>

      {left > 0 && (
        <p className="text-text-primary text-sm" data-testid="deviation-scan-progress">
          {scanning ? 'Checking your games' : 'Paused'}: {left} {left === 1 ? 'game' : 'games'} left.
          {!scanning && ' Picks up next time this page or the dashboard is open.'}
        </p>
      )}

      {hero && <OpeningsHero summary={hero} drills={heroDrills} onDrill={() => drill(heroDrills.map((d) => d.id), familyName(hero))} />}

      <div role="tablist" aria-label="Colour" className="flex gap-1.5">
        {COLOR_TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={color === id}
            data-testid={`tab-${id}`}
            onClick={() => setColor(id)}
            className={clsx(
              'px-4 py-2 text-sm font-mono uppercase tracking-tight border-2 rounded-none transition-colors',
              color === id
                ? 'bg-text-primary text-bg border-text-primary'
                : 'bg-surface text-text-primary border-text-primary hover:bg-accent/15',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {query.isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <p className="text-text-primary text-sm">Couldn't load your opening analysis. Try again later.</p>
      ) : summaries.length === 0 ? (
        <div className="card flex flex-col gap-2" data-testid="openings-empty">
          <h2 className="heading-md">Nothing to show yet</h2>
          <p className="text-text-primary text-sm">
            {scanning
              ? 'Your games are being checked. Results appear here as they come in.'
              : 'Sync your Lichess or Chess.com games from the dashboard and they will be checked here.'}
          </p>
          {!scanning && (
            <Link to="/dashboard" className="pill self-start">
              Go to dashboard
            </Link>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {summaries.map((s) => {
            const key = `${s.family}|${s.color}`;
            return (
              <OpeningPatternCard
                key={key}
                summary={s}
                expanded={openKey === key}
                onToggle={() => setExpanded(openKey === key ? '' : key)}
                drillMap={drillsQuery.data}
                repertoire={repertoire.data}
                onDrill={drill}
              />
            );
          })}
        </div>
      )}

      <p className="text-text-secondary text-xs" data-testid="book-attribution">
        Opening statistics from the{' '}
        <a className="underline" href="https://database.lichess.org/#broadcasts" target="_blank" rel="noreferrer">
          Lichess broadcast database
        </a>{' '}
        (both players rated 2200+, CC BY-SA 4.0) and the{' '}
        <a className="underline" href="https://database.nikonoel.fr/" target="_blank" rel="noreferrer">
          Lichess Elite Database
        </a>
        , with move checks from the{' '}
        <a className="underline" href="https://database.lichess.org/#evals" target="_blank" rel="noreferrer">
          Lichess evaluation database
        </a>{' '}
        and Stockfish.
      </p>
    </div>
  );
}
