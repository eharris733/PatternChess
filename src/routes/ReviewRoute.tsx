import { useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BoardPanel } from '../components/BoardPanel';
import { BoardControls } from '../components/BoardControls';
import { ClassificationButtons } from '../components/ClassificationButtons';
import { EvalDisplay } from '../components/EvalDisplay';
import { FeedbackBadge } from '../components/FeedbackBadge';
import { MoveSequencePanel, type MovePair } from '../components/MoveSequencePanel';
import { classifySwing, useReviewStore } from '../state/reviewStore';
import { annotationKey } from '../models/gameAnnotation';
import { orderedPlayers } from '../models/gameRecord';
import {
  GAME_STATE_LABEL,
  classifyGameState,
  computeTimeRemainingPercent,
  TIME_TROUBLE_THRESHOLD_PERCENT,
} from '../chess/blunderContext';
import {
  externalAnalysisUrl,
  resolvePlatform,
} from '../services/externalAnalysisUrlService';

export function ReviewRoute() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const r = useReviewStore();

  useEffect(() => {
    if (gameId) void r.load(gameId);
    return () => r.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.code === 'ArrowRight') {
        e.preventDefault();
        r.next();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        r.prev();
      } else if (e.code === 'Space') {
        e.preventDefault();
        r.next();
      } else if (e.code === 'Home') r.first();
      else if (e.code === 'End') r.last();
      else if (e.code === 'KeyA') r.setGrade('A');
      else if (e.code === 'KeyS') r.setGrade('S');
      else if (e.code === 'KeyD') r.setGrade('D');
      else if (e.code === 'KeyF') r.setGrade('F');
      else if (e.code === 'KeyX') r.flip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [r]);

  const pairs = useMemo<MovePair[]>(() => {
    const out: MovePair[] = [];
    let current: MovePair | null = null;
    for (let i = 0; i < r.positions.length - 1; i++) {
      const p = r.positions[i];
      if (!p.sanMove) continue;
      const key = annotationKey(p.moveNumber, p.sideToMove);
      const annot = r.annotations[key];
      const tag = r.bookMoves[i] === true ? 'BOOK' : r.lastBookMoveIndex === i ? 'NEW' : undefined;

      // Context tags only render once we've actually evaluated the move and the
      // engine considers it a mistake/blunder — otherwise every move would be
      // tagged "Roughly equal", which is noise.
      let contextTags: string[] | undefined;
      const ev = r.engineEvals[i];
      if (ev) {
        const cl = classifySwing(ev.before, ev.after);
        if (cl.classification === 'blunder' || cl.classification === 'mistake') {
          const tags: string[] = [];
          const bucket = classifyGameState(ev.before);
          if (r.game) {
            const sideToMove =
              p.sideToMove === 'white' ? 'white' : 'black';
            const pct = computeTimeRemainingPercent(
              { moveNumber: p.moveNumber, sideToMove },
              r.game,
            );
            if (pct !== null && pct < TIME_TROUBLE_THRESHOLD_PERCENT) {
              tags.push(`Time trouble · ${Math.round(pct)}%`);
            }
          }
          if (bucket !== 'roughlyEqual') tags.push(GAME_STATE_LABEL[bucket]);
          if (tags.length > 0) contextTags = tags;
        }
      }

      const cell = {
        san: p.sanMove,
        key: `i${i}`,
        grade: annot?.classification ?? null,
        tag,
        contextTags,
      };
      if (p.sideToMove === 'white') {
        current = { moveNumber: p.moveNumber, white: cell, black: undefined };
        out.push(current);
      } else {
        if (current && current.moveNumber === p.moveNumber) {
          current.black = cell;
        } else {
          current = { moveNumber: p.moveNumber, white: undefined, black: cell };
          out.push(current);
        }
      }
    }
    return out;
  }, [r.positions, r.annotations, r.bookMoves, r.lastBookMoveIndex, r.engineEvals, r.game]);

  if (r.loading) return <div className="text-text-secondary text-sm">Loading game…</div>;
  if (r.error)
    return (
      <div className="card text-center max-w-md mx-auto flex flex-col gap-3">
        <p className="text-incorrect">{r.error}</p>
        <button className="btn-outline" onClick={() => navigate('/vault')}>
          Back to vault
        </button>
      </div>
    );
  if (!r.game) return null;

  const pos = r.positions[r.currentIndex];
  const activeKey = `i${r.currentIndex}`;
  const displayFen =
    r.positions[r.currentIndex + 1]?.fen ?? r.positions[r.currentIndex]?.fen ?? '';
  const currentAnnotation = pos
    ? r.annotations[annotationKey(pos.moveNumber, pos.sideToMove)]
    : undefined;
  const ev = r.engineEvals[r.currentIndex];
  const swing = ev ? classifySwing(ev.before, ev.after) : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6">
      <div className="flex flex-col gap-3">
        <header>
          <h1 className="heading-md">
            {orderedPlayers(r.game.username, r.game.opponent, r.game.userColor)[0]}{' '}
            <span className="text-text-secondary">vs</span>{' '}
            {orderedPlayers(r.game.username, r.game.opponent, r.game.userColor)[1]}
          </h1>
          <p className="text-text-secondary text-sm">
            {r.game.platform} · {r.game.timeControl ?? '—'} ·{' '}
            {r.game.playedAt ? r.game.playedAt.toLocaleDateString() : 'unknown date'}
          </p>
        </header>

        <BoardPanel
          fen={displayFen}
          orientation={r.orientation}
          movableFor={null}
          viewOnly
        />

        {(() => {
          const platform = resolvePlatform(r.game.platform, null);
          const ext =
            platform && displayFen
              ? externalAnalysisUrl(platform, displayFen, { orientation: r.orientation })
              : null;
          return (
            <BoardControls
              canPrev={r.currentIndex > 0}
              canNext={r.currentIndex < r.positions.length - 2}
              onFirst={r.first}
              onPrev={r.prev}
              onNext={r.next}
              onLast={r.last}
              externalUrl={ext?.url ?? null}
              externalLabel={ext?.label}
            />
          );
        })()}
      </div>

      <aside className="card flex flex-col gap-4 sticky top-6 self-start max-h-[calc(100vh-3rem)] overflow-y-auto">
        <div className="flex items-center justify-between">
          <span className="label">Move</span>
          <span className="font-mono text-xs text-text-secondary">
            {pos?.moveNumber ?? '—'}.{pos?.sideToMove === 'white' ? '' : '..'}{' '}
            {pos?.sanMove ?? 'start'}
          </span>
        </div>

        <div className="flex gap-2">
          <button
            className={`pill ${r.phase === 'human' ? '' : ''}`}
            aria-pressed={r.phase === 'human'}
            onClick={() => r.setPhase('human')}
          >
            Annotate
          </button>
          <button
            className="pill"
            aria-pressed={r.phase === 'engine'}
            onClick={() => r.setPhase('engine')}
          >
            Engine
          </button>
          <button className="pill ml-auto" onClick={() => r.flip()}>
            Flip
          </button>
        </div>

        {r.phase === 'human' && pos?.sanMove && (
          <>
            <ClassificationButtons
              value={currentAnnotation?.classification ?? null}
              onChange={(g) => r.setGrade(g)}
            />
            <textarea
              className="input min-h-[80px] py-2"
              placeholder="Coach's note (optional)"
              value={currentAnnotation?.text ?? ''}
              onChange={(e) => r.setText(e.target.value)}
            />
          </>
        )}

        {r.phase === 'engine' && (
          <>
            <button
              className="btn-outline"
              onClick={() => void r.evaluateCurrent()}
              disabled={r.evaluating || !pos?.sanMove}
            >
              {r.evaluating ? 'Evaluating…' : 'Check this move'}
            </button>

            {ev && swing && pos && pos.sanMove && (
              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Engine eval before</span>
                  <EvalDisplay cp={ev.before} />
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Engine eval after</span>
                  <EvalDisplay cp={ev.after} />
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Engine best</span>
                  <span className="font-mono text-text-primary">{ev.bestMove || '—'}</span>
                </div>
                <FeedbackBadge
                  tone={
                    swing.classification === 'blunder'
                      ? 'danger'
                      : swing.classification === 'mistake'
                        ? 'warning'
                        : swing.classification === 'inaccuracy'
                          ? 'info'
                          : 'success'
                  }
                >
                  {pos.sanMove === ev.bestMove
                    ? 'Engine agrees — this is the best move.'
                    : swing.classification === 'good'
                      ? 'Solid move; not the engine\'s top pick.'
                      : `Engine flags this as a ${swing.classification} (${swing.chancesLost.toFixed(1)}% chances lost).`}
                </FeedbackBadge>
              </div>
            )}
          </>
        )}

        <div className="border-t-2 border-text-primary pt-3">
          <p className="label mb-2">Moves</p>
          <MoveSequencePanel
            pairs={pairs}
            activeKey={activeKey}
            onSelect={(key) => {
              const i = Number.parseInt(key.slice(1), 10);
              if (!Number.isNaN(i)) r.setIndex(i);
            }}
          />
        </div>
      </aside>
    </div>
  );
}
