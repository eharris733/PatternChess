import { useEffect } from 'react';
import { Chess } from 'chess.js';
import clsx from 'clsx';
import { BoardPanel } from '../BoardPanel';
import { FeedbackBadge } from '../FeedbackBadge';
import { useOpeningTrainerStore } from '../../state/openingTrainerStore';
import { RepertoireColor, RepertoireMove } from '../../models/repertoire';
import { PositionStats } from '../../services/positionFrequencyService';
import { OpponentBand } from '../../services/opponentMoveSampler';
import { parseUciMove } from '../../chess/moveUtils';

function lineToDisplay(line: string[]): string {
  const chess = new Chess();
  const parts: string[] = [];
  for (let i = 0; i < line.length; i++) {
    try {
      const m = parseUciMove(line[i]);
      const r = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
      if (!r) break;
      parts.push(i % 2 === 0 ? `${i / 2 + 1}.${r.san}` : r.san);
    } catch {
      break;
    }
  }
  return parts.join(' ');
}

/**
 * Practice mode: play your repertoire from move one against an opponent whose
 * replies are weighted toward what you actually face. Lines end at the edge of
 * your book (grow it from there) or on a mistake (logged into the training
 * queue).
 */
export function OpeningPracticePanel({
  color,
  repertoire,
  stats,
  band,
  userRating,
  onExtend,
}: {
  color: RepertoireColor;
  repertoire: Map<string, RepertoireMove>;
  stats: Map<string, PositionStats> | null;
  band: OpponentBand;
  userRating: number | null;
  onExtend: (epd: string, line: string[]) => void;
}) {
  const trainer = useOpeningTrainerStore();

  const startLine = () =>
    void useOpeningTrainerStore.getState().start({
      deps: { color, repertoire, stats, band, userRating },
      logMistakes: true,
    });

  useEffect(() => {
    startLine();
    return () => useOpeningTrainerStore.getState().reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color]);

  const playing =
    trainer.phase === 'solving' || trainer.phase === 'thinking' || trainer.phase === 'evaluating';
  const lineDisplay = lineToDisplay(trainer.line);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between rounded-none border-2 border-text-primary bg-surface-3 px-3 py-2">
          <span className="font-mono text-xs uppercase tracking-tight text-gold-dark">
            {lineDisplay || 'Start position'}
          </span>
          <span className="font-mono text-xs tabular-nums text-text-secondary">
            {repertoire.size} book move{repertoire.size === 1 ? '' : 's'}
          </span>
        </div>
        <BoardPanel
          fen={trainer.fen || new Chess().fen()}
          orientation={color}
          movableFor={trainer.phase === 'solving' ? color : null}
          lastMove={trainer.lastMove}
          onMove={(m) => void trainer.processMove(m)}
        />
      </div>

      <aside className="card flex flex-col gap-4 self-start max-h-[calc(100vh-3rem)] overflow-y-auto">
        <header className="flex items-center justify-between">
          <span className="label">Practice your book</span>
        </header>

        {playing && (
          <div className="flex items-center gap-2 text-text-primary">
            <span
              className={clsx(
                'w-3 h-3 rounded-full border-2 border-text-primary',
                color === 'white' ? 'bg-surface' : 'bg-black',
              )}
            />
            <span className="font-medium">Play your repertoire move</span>
          </div>
        )}

        {trainer.phase === 'thinking' && <FeedbackBadge tone="info">Opponent thinking…</FeedbackBadge>}
        {trainer.phase === 'evaluating' && (
          <FeedbackBadge tone="info">Checking your move…</FeedbackBadge>
        )}
        {trainer.toleratedNote && (
          <FeedbackBadge tone="success">{trainer.toleratedNote}</FeedbackBadge>
        )}
        {trainer.engineError && (
          <FeedbackBadge tone="warning">Engine hiccup — book moves only</FeedbackBadge>
        )}

        {trainer.phase === 'mistake' && trainer.mistake && (
          <>
            <FeedbackBadge tone="danger">
              {trainer.mistake.chancesLost >= 15
                ? "That's a mistake"
                : "That's not your best line"}
            </FeedbackBadge>
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
              <p className="text-text-secondary text-xs mt-1">
                Logged — this position joins your training queue.
              </p>
            </div>
            <button className="btn-primary" onClick={startLine}>
              New line
            </button>
          </>
        )}

        {trainer.phase === 'out-of-book' && (
          <>
            <FeedbackBadge tone="success">Out of book — line complete</FeedbackBadge>
            <p className="text-text-secondary text-sm">
              You played your whole repertoire for this line. Extend it from here so next time
              the line goes deeper.
            </p>
            {trainer.outOfBookEpd && (
              <button
                className="btn-primary"
                onClick={() => onExtend(trainer.outOfBookEpd!, trainer.line)}
              >
                Extend repertoire from here
              </button>
            )}
            <button className="btn-ghost" onClick={startLine}>
              New line
            </button>
          </>
        )}

        {trainer.phase === 'line-complete' && (
          <>
            <FeedbackBadge tone="success">Line complete</FeedbackBadge>
            <button className="btn-primary" onClick={startLine}>
              New line
            </button>
          </>
        )}
      </aside>
    </div>
  );
}
