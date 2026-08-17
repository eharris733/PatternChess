import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { BoardPanel } from '../BoardPanel';
import { BoardActionBar } from '../BoardActionBar';
import { FeedbackBadge } from '../FeedbackBadge';
import { ProgressBar } from '../ProgressBar';
import { PositionSrState } from './PositionSrState';
import { useTrainingStore } from '../../state/trainingStore';
import { useOpeningTrainerStore } from '../../state/openingTrainerStore';
import { Blunder, OpeningDrillData } from '../../models/blunder';
import { RepertoireMove } from '../../models/repertoire';
import { supabaseService } from '../../services/supabaseService';
import { useGames } from '../../hooks/useGames';
import { getFrequencyIndex } from '../../services/positionFrequencyService';
import { bandFromGames } from '../../services/opponentMoveSampler';
import { toEpd } from '../../chess/moveUtils';
import { useAuth } from '../../auth/useAuth';
import type { DrawShape } from 'chessground/draw';

/**
 * Unified-queue drill for opening-kind items: from the drilled position the
 * user plays their repertoire out to the end of book coverage against the
 * weighted opponent. Zero mistakes to the edge of book = success; the first
 * mistake fails the drill (and logs any new slip position). Presentation
 * matches a tactic drill until the first move — the user shouldn't know which
 * kind of test a position is in advance.
 */
export function OpeningDrillView({
  blunder,
  drillData,
  showFilterBanner,
}: {
  blunder: Blunder;
  drillData: OpeningDrillData;
  showFilterBanner?: React.ReactNode;
}) {
  const { user } = useAuth();
  const training = useTrainingStore();
  const trainer = useOpeningTrainerStore();
  const [paused, setPaused] = useState(false);
  const [hintLevel, setHintLevel] = useState<0 | 1 | 2>(0);
  const startedForRef = useRef<string | null>(null);

  const color = drillData.color;
  const revealed =
    trainer.userMovesPlayed > 0 || training.phase === 'correct' || training.phase === 'incorrect';

  const gamesQuery = useGames();
  const games = gamesQuery.data;

  const repertoireQuery = useQuery({
    queryKey: ['repertoire', user?.id, color],
    queryFn: () => supabaseService.getRepertoireMoves(color),
    enabled: !!user,
  });
  const repertoire = useMemo(() => {
    const m = new Map<string, RepertoireMove>();
    for (const r of repertoireQuery.data ?? []) m.set(r.epd, r);
    return m;
  }, [repertoireQuery.data]);

  const indexQuery = useQuery({
    queryKey: ['freqIndex', user?.id, games?.length, games?.[0]?.id],
    queryFn: () => getFrequencyIndex(games ?? []),
    enabled: !!games,
  });
  const band = useMemo(() => bandFromGames(games ?? []), [games]);

  const depsReady = !!repertoireQuery.data && (!games || !!indexQuery.data);

  // Play-outs are always blind — skip the optional review step.
  useEffect(() => {
    if (training.phase === 'reviewing') training.proceedFromReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [training.phase]);

  useEffect(() => {
    if (training.phase !== 'solving' || !depsReady) return;
    const needsStart =
      startedForRef.current !== blunder.id ||
      trainer.phase === 'idle' ||
      trainer.phase === 'mistake' ||
      trainer.phase === 'out-of-book' ||
      trainer.phase === 'line-complete';
    if (!needsStart) return;
    startedForRef.current = blunder.id;
    setHintLevel(0);
    void useOpeningTrainerStore.getState().start({
      deps: {
        color,
        repertoire,
        stats: indexQuery.data?.forColor(color) ?? null,
        band,
        userRating: band.userRating,
      },
      startFen: blunder.fen,
      expectedOverride: { epd: toEpd(blunder.fen), uci: drillData.repertoireMove },
      logMistakes: true,
      onFinish: (r) => {
        useTrainingStore.getState().completeExternalDrill({
          success: r.success,
          feedback: r.success
            ? null
            : {
                message:
                  r.mistake && r.mistake.chancesLost >= 15
                    ? "That's a mistake"
                    : "That's not your book move",
                tone: 'danger',
              },
        });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [training.phase, blunder.id, depsReady]);

  const onHint = () => {
    const expected = trainer.currentExpectedUci;
    if (!expected || hintLevel >= 2) return;
    if (hintLevel === 0) {
      useTrainingStore.getState().markExternalAttempt();
    }
    setHintLevel((h) => (h === 0 ? 1 : 2));
  };

  const hintShapes: DrawShape[] = (() => {
    const expected = trainer.currentExpectedUci;
    if (!expected || hintLevel === 0 || trainer.phase !== 'solving') return [];
    const orig = expected.slice(0, 2) as DrawShape['orig'];
    if (hintLevel === 1) return [{ orig, brush: 'blue' }];
    return [{ orig, dest: expected.slice(2, 4) as DrawShape['orig'], brush: 'blue' }];
  })();

  const playing =
    trainer.phase === 'solving' ||
    trainer.phase === 'thinking' ||
    trainer.phase === 'evaluating' ||
    trainer.phase === 'loading';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6">
      <div className="flex flex-col gap-3">
        {showFilterBanner}
        <div
          className={clsx(
            'transition duration-200',
            paused && 'blur-md pointer-events-none select-none',
          )}
          aria-hidden={paused}
        >
          <BoardPanel
            fen={trainer.fen || blunder.fen}
            orientation={color}
            movableFor={trainer.phase === 'solving' && !paused ? color : null}
            lastMove={trainer.lastMove}
            shapes={hintShapes}
            onMove={(m) => void trainer.processMove(m)}
          />
        </div>

        <BoardActionBar
          resetKey={training.currentIndex}
          running={trainer.phase === 'solving' && !paused}
          paused={paused}
          onTogglePaused={() => setPaused((p) => !p)}
          showHint={trainer.phase === 'solving'}
          hintLevel={hintLevel}
          hintDisabled={hintLevel >= 2 || !trainer.currentExpectedUci || paused}
          onHint={onHint}
          externalUrl={null}
        />
      </div>

      <aside className="card flex flex-col gap-4 sticky top-6 self-start max-h-[calc(100vh-3rem)] overflow-y-auto">
        <header className="flex items-center justify-between">
          <span className="label">Training</span>
          <span className="font-mono text-xs tabular-nums text-gold-dark">
            {`${training.currentIndex + 1}/${training.blunders.length}`}
          </span>
        </header>

        {training.pendingTryAgain && (
          <div className="flex items-center gap-2 rounded-none border-2 border-mistake/50 bg-mistake/15 px-3 py-2">
            <span className="px-2 py-0.5 rounded-none font-mono text-[10px] uppercase tracking-tight bg-mistake/30 text-mistake border-2 border-mistake/60">
              Retry
            </span>
            <span className="text-xs text-text-primary">You missed this last time</span>
          </div>
        )}

        <PositionSrState
          blunder={blunder}
          showTryAgainLabel={training.pendingTryAgain}
          showNextReview={playing && !revealed}
        />

        {playing && (
          <div className="flex items-center gap-2 text-text-primary">
            <span
              className={clsx(
                'w-3 h-3 rounded-full border-2 border-text-primary',
                color === 'white' ? 'bg-surface' : 'bg-black',
              )}
            />
            <span className="font-medium">{color === 'white' ? 'White' : 'Black'} to play</span>
          </div>
        )}

        {revealed && playing && (
          <FeedbackBadge tone="info">Book line — keep playing your repertoire</FeedbackBadge>
        )}
        {trainer.phase === 'loading' && <FeedbackBadge tone="info">Loading position…</FeedbackBadge>}
        {trainer.phase === 'thinking' && <FeedbackBadge tone="info">Opponent thinking…</FeedbackBadge>}
        {trainer.phase === 'evaluating' && (
          <FeedbackBadge tone="info">Checking your move…</FeedbackBadge>
        )}
        {trainer.toleratedNote && playing && (
          <FeedbackBadge tone="success">{trainer.toleratedNote}</FeedbackBadge>
        )}
        {hintLevel > 0 && playing && (
          <p className="text-text-secondary text-xs">Hint shown — counts as a fail for recall.</p>
        )}

        {training.phase === 'correct' && (
          <>
            <FeedbackBadge tone="success">
              {trainer.phase === 'out-of-book'
                ? 'Book line held — end of your coverage'
                : 'Book line held'}
            </FeedbackBadge>
            <p className="text-text-secondary text-sm">
              You played your repertoire all the way out of book.
            </p>
            <button className="btn-primary mt-auto" onClick={() => training.advance()}>
              Next (Space)
            </button>
          </>
        )}

        {training.phase === 'incorrect' && (
          <>
            {training.incorrectFeedback && (
              <FeedbackBadge tone={training.incorrectFeedback.tone}>
                {training.incorrectFeedback.message}
              </FeedbackBadge>
            )}
            {trainer.mistake && (
              <div className="bg-surface-3 rounded-none border-2 border-text-primary p-3 text-sm flex flex-col gap-1">
                <p>
                  <span className="text-text-secondary">You played </span>
                  <span className="font-mono font-bold text-incorrect">
                    {trainer.mistake.playedSan ?? trainer.mistake.playedUci}
                  </span>
                </p>
                {trainer.mistake.bookSan && (
                  <p>
                    <span className="text-text-secondary">Your book move is </span>
                    <span className="font-mono font-bold text-correct">
                      {trainer.mistake.bookSan}
                    </span>
                  </p>
                )}
              </div>
            )}
            <button className="btn-primary mt-auto" onClick={() => training.requeueAndAdvance()}>
              Continue (Space)
            </button>
            <p className="text-text-secondary text-xs text-center -mt-1">
              Comes back later this session
            </p>
          </>
        )}

        <div className="mt-auto pt-2">
          <ProgressBar
            current={Math.round(
              training.totalAttempted > 0
                ? (training.totalCorrect / training.totalAttempted) * 100
                : 0,
            )}
            total={100}
            label="Recall rate"
          />
        </div>
      </aside>
    </div>
  );
}
