import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { MIN_POSITION_GAMES } from '../../chess/openingDeviation';
import { bookPlayersLabel } from '../../chess/bookFormat';
import {
  fetchBookPosition,
  peekBookPosition,
  positionGames,
  type BookMove,
} from '../../services/openingBookService';

const ROWS_SHOWN = 8;
/** Every row is the same height so the list never changes size between positions. */
const ROW_REM = 2.25;
/** Below this a segment is too narrow for its label. */
const MIN_LABELLED_PCT = 12;

/**
 * Results as chess colours, White | Draw | Black, left to right (the Lichess
 * explorer convention): never re-coloured from the user's side.
 */
function ResultBar({ move }: { move: BookMove }) {
  const games = move.white + move.draws + move.black;
  if (games === 0) return null;
  const white = (move.white / games) * 100;
  const black = (move.black / games) * 100;
  const draw = 100 - white - black;
  const seg = (pct: number) => (pct >= MIN_LABELLED_PCT ? `${Math.round(pct)}%` : '');
  return (
    <div
      className="flex h-5 w-full overflow-hidden border border-text-primary/30 font-mono text-[11px] leading-5 tabular-nums"
      title={`White ${Math.round(white)}% · Draw ${Math.round(draw)}% · Black ${Math.round(black)}%`}
    >
      <div className="bg-[#ffffff] text-[#1a1a1a] text-center" style={{ width: `${white}%` }}>
        {seg(white)}
      </div>
      <div className="bg-[#a0a0a0] text-[#1a1a1a] text-center" style={{ width: `${draw}%` }}>
        {seg(draw)}
      </div>
      <div className="bg-[#3a3a3a] text-[#ffffff] text-center" style={{ width: `${black}%` }}>
        {seg(black)}
      </div>
    </div>
  );
}

/**
 * The database's moves for whatever position is on the board: each book
 * move with its game count and results. Clicking a move plays it on the
 * board (the caller keeps it as an explore branch).
 *
 * The list keeps a fixed height and shows the previous position while the
 * next one loads, so stepping through a line never resizes the page (a
 * resize redraws the board mid-animation).
 */
export function BookExplorerPanel({
  fen,
  gameMoveUci,
  playedUci,
  theoryUcis,
  onPlay,
}: {
  fen: string;
  /** The move the game continued with from here (tagged "Game"). */
  gameMoveUci: string | null;
  /** The exit move itself, when this is the exit position (tagged "You"). */
  playedUci: string | null;
  /** Theory answers at the exit position (tagged "Book"). */
  theoryUcis: string[];
  onPlay: (uci: string) => void;
}) {
  const query = useQuery({
    queryKey: ['book', 'position', fen.split(' ').slice(0, 4).join(' ')],
    queryFn: () => fetchBookPosition(fen),
    initialData: () => peekBookPosition(fen),
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });
  const pos = query.data;
  const total = pos ? positionGames(pos) : 0;
  const inBook = !!pos && total >= MIN_POSITION_GAMES && pos.moves.length > 0;

  return (
    <section className="flex flex-col gap-2" data-testid="book-explorer">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label">Book</span>
        {inBook && (
          <span className="text-text-primary text-xs">
            {total.toLocaleString()} {total === 1 ? 'game' : 'games'} by {bookPlayersLabel(pos.tier)}
          </span>
        )}
      </div>

      <div style={{ minHeight: `${ROWS_SHOWN * ROW_REM}rem` }}>
        {query.isPending ? (
          <p className="text-text-primary text-sm">Looking up this position…</p>
        ) : pos === undefined || query.isError ? (
          <p className="text-text-primary text-sm">The opening book didn't answer. Try again in a moment.</p>
        ) : !inBook ? (
          <p className="text-text-primary text-sm" data-testid="book-empty">
            Out of book. Too few strong players have reached this position.
          </p>
        ) : (
          <ul
            className={clsx(
              'flex flex-col border-y border-text-primary/15 transition-opacity',
              query.isPlaceholderData && 'opacity-60',
            )}
          >
            {pos.moves.slice(0, ROWS_SHOWN).map((m) => {
              const games = m.white + m.draws + m.black;
              const sharePct = Math.round((games / total) * 100);
              const isPlayed = m.uci === playedUci;
              const isTheory = theoryUcis.includes(m.uci);
              const isGame = !isPlayed && m.uci === gameMoveUci;
              return (
                <li key={m.uci} className="border-b border-text-primary/10 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => onPlay(m.uci)}
                    data-testid="book-move"
                    style={{ height: `${ROW_REM}rem` }}
                    className={clsx(
                      'w-full grid grid-cols-[4rem_1fr_5.5rem] items-center gap-3 border-l-4 px-2 text-left text-sm transition-colors hover:bg-accent/10',
                      isTheory ? 'border-correct' : isPlayed ? 'border-incorrect' : 'border-transparent',
                    )}
                  >
                    <span className="flex items-baseline gap-1.5 min-w-0">
                      <span className="font-mono font-semibold text-text-primary">{m.san}</span>
                      {m.sound === false && (
                        <span className="text-mistake text-xs font-semibold" title="The engine rejects this move">
                          ?!
                        </span>
                      )}
                    </span>
                    <ResultBar move={m} />
                    <span
                      className="text-right font-mono text-xs tabular-nums text-text-primary"
                      title={`${games.toLocaleString()} ${games === 1 ? 'game' : 'games'}`}
                    >
                      {isTheory ? (
                        <span className="font-semibold text-correct">Book </span>
                      ) : isPlayed ? (
                        <span className="font-semibold text-incorrect">You </span>
                      ) : isGame ? (
                        <span className="font-semibold">Game </span>
                      ) : null}
                      {sharePct}%
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
