import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../auth/useAuth';
import { useGames } from '../hooks/useGames';
import { useSyncStore } from '../state/syncStore';
import { usePgnUploadStore } from '../state/pgnUploadStore';
import { supabaseService } from '../services/supabaseService';
import { platformGameUrl } from '../services/externalAnalysisUrlService';
import { extractHeaders } from '../services/pgnParserService';
import { orderedPlayers, resolveOutcome, type GameOutcome } from '../models/gameRecord';
import type { GameRecord } from '../models/gameRecord';
import type { Blunder } from '../models/blunder';
import { MOTIF_LABEL } from '../chess/motifs';
import { uciToSan, fenSideToMove } from '../chess/moveUtils';
import { MiniBoard } from '../components/MiniBoard';
import { TrashIcon } from '../components/icons/TrashIcon';
import { ChevronIcon } from '../components/icons/ChevronIcon';
import { CloseIcon } from '../components/icons/CloseIcon';

type Outcome = GameOutcome;

const ANALYZED_STORAGE_PREFIX = 'pc:analyzed-externally:';

function loadAnalyzedSet(userId: string | null | undefined): Set<string> {
  if (!userId) return new Set();
  try {
    const raw = localStorage.getItem(ANALYZED_STORAGE_PREFIX + userId);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function persistAnalyzedSet(userId: string, set: Set<string>): void {
  try {
    localStorage.setItem(ANALYZED_STORAGE_PREFIX + userId, JSON.stringify([...set]));
  } catch {
    // localStorage unavailable — silently ignore
  }
}

function gameOutcome(game: GameRecord): Outcome | null {
  // Prefer the stored color; fall back to PGN headers for older rows where
  // user_color was never parsed.
  let color = game.userColor;
  if (!color && (game.platform === 'lichess' || game.platform === 'pgn')) {
    const isWhite =
      extractHeaders(game.pgn).White?.toLowerCase() === game.username.toLowerCase();
    color = isWhite ? 'white' : 'black';
  }
  return resolveOutcome(game.platform, game.result, color);
}

type BlunderFilter = 'all' | 'min1' | 'min2' | 'min3' | 'clean' | 'unanalyzed';
type ResultFilter = 'all' | 'win' | 'loss' | 'draw';
type SortOrder = 'newest' | 'oldest' | 'blunders';

const BLUNDER_FILTERS: Array<{ key: BlunderFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'min1', label: 'Has blunders' },
  { key: 'min2', label: '2+' },
  { key: 'min3', label: '3+' },
  { key: 'clean', label: 'No blunders' },
  { key: 'unanalyzed', label: 'Not analyzed' },
];

function matchesBlunderFilter(
  filter: BlunderFilter,
  game: GameRecord,
  count: number,
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'min1':
      return !!game.analyzedAt && count >= 1;
    case 'min2':
      return !!game.analyzedAt && count >= 2;
    case 'min3':
      return !!game.analyzedAt && count >= 3;
    case 'clean':
      return !!game.analyzedAt && count === 0;
    case 'unanalyzed':
      return !game.analyzedAt;
  }
}

function gameSortTime(g: GameRecord): number {
  return (g.playedAt ?? g.createdAt).getTime();
}

/**
 * Native select styled like `.input`, with the platform chevron replaced by an
 * inline icon so the arrow gets real right padding and sits centred, matching
 * the search field beside it.
 */
function VaultSelect({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        {...props}
        className={clsx('input h-9 w-auto appearance-none pr-9 cursor-pointer', className)}
      >
        {children}
      </select>
      <ChevronIcon className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rotate-90 text-text-primary" />
    </div>
  );
}

export function VaultRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  const { data: games, isLoading } = useGames();
  const [deleteTarget, setDeleteTarget] = useState<GameRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [blunderFilter, setBlunderFilter] = useState<BlunderFilter>('all');
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOrder>('newest');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ blunder: Blunder; game: GameRecord } | null>(
    null,
  );

  const confirmDeleteGame = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const deleted = await supabaseService.deleteGame(deleteTarget.id);
      if (deleted === 0) {
        // No error raised, but nothing was removed — typically a row-level
        // policy block. Surface it instead of pretending the delete worked.
        setDeleteError(
          "That game couldn't be deleted — it may be a permissions issue. Nothing was removed.",
        );
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['games', user?.id] });
      await queryClient.invalidateQueries({ queryKey: ['blunderCounts', user?.id] });
      await queryClient.invalidateQueries({ queryKey: ['blunders'] });
      setDeleteTarget(null);
    } catch (err) {
      console.error('Failed to delete game', err);
      setDeleteError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, queryClient, user?.id]);
  const { data: blunderCounts } = useQuery({
    queryKey: ['blunderCounts', user?.id],
    queryFn: () => supabaseService.getBlunderCountsByGame({ userId: user?.id }),
    enabled: !!user,
  });
  const [analyzedIds, setAnalyzedIds] = useState<Set<string>>(() => loadAnalyzedSet(user?.id));
  const markAnalyzed = useCallback(
    (gameId: string) => {
      if (!user?.id) return;
      setAnalyzedIds((prev) => {
        if (prev.has(gameId)) return prev;
        const next = new Set(prev);
        next.add(gameId);
        persistAnalyzedSet(user.id, next);
        return next;
      });
    },
    [user?.id],
  );
  const triggerNow = useSyncStore((s) => s.triggerNow);
  const isSyncing = useSyncStore((s) => {
    const busy = (phase: string) =>
      phase === 'fetching' || phase === 'inserting' || phase === 'analyzing';
    return busy(s.providers.lichess.phase) || busy(s.providers.chesscom.phase);
  });
  const openUpload = usePgnUploadStore((s) => s.openModal);
  const hasAccount = !!(profile?.lichessUsername || profile?.chesscomUsername);

  const filterCounts = useMemo(() => {
    const counts = {} as Record<BlunderFilter, number>;
    for (const f of BLUNDER_FILTERS) counts[f.key] = 0;
    for (const g of games ?? []) {
      const count = blunderCounts?.[g.id] ?? 0;
      for (const f of BLUNDER_FILTERS) {
        if (matchesBlunderFilter(f.key, g, count)) counts[f.key]++;
      }
    }
    return counts;
  }, [games, blunderCounts]);

  const filteredGames = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = (games ?? []).filter((g) => {
      const count = blunderCounts?.[g.id] ?? 0;
      if (!matchesBlunderFilter(blunderFilter, g, count)) return false;
      if (resultFilter !== 'all' && gameOutcome(g) !== resultFilter) return false;
      if (q) {
        const hay = [g.opponent, g.username, g.openingName ?? '', g.platform]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const byDateDesc = (a: GameRecord, b: GameRecord) => gameSortTime(b) - gameSortTime(a);
    if (sort === 'oldest') items.sort((a, b) => gameSortTime(a) - gameSortTime(b));
    else if (sort === 'blunders')
      items.sort(
        (a, b) =>
          (blunderCounts?.[b.id] ?? 0) - (blunderCounts?.[a.id] ?? 0) || byDateDesc(a, b),
      );
    else items.sort(byDateDesc);
    return items;
  }, [games, blunderCounts, blunderFilter, resultFilter, search, sort]);

  const filtersActive =
    blunderFilter !== 'all' || resultFilter !== 'all' || search.trim() !== '';

  const clearFilters = useCallback(() => {
    setBlunderFilter('all');
    setResultFilter('all');
    setSearch('');
  }, []);

  if (isLoading) {
    return <div className="text-text-secondary text-sm">Loading…</div>;
  }

  if (!games || games.length === 0) {
    return (
      <div className="max-w-xl mx-auto card text-center flex flex-col gap-4">
        <h1 className="heading-lg">No games yet</h1>
        <p className="text-text-secondary text-sm">
          {hasAccount
            ? 'Sync your latest games, or upload your own PGNs to populate the vault.'
            : 'Connect a Lichess or Chess.com account, or upload your own PGNs to start.'}
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          {hasAccount ? (
            <button
              className="btn-primary"
              disabled={isSyncing || !profile}
              onClick={() => profile && void triggerNow(profile)}
            >
              {isSyncing ? 'Syncing…' : 'Sync now'}
            </button>
          ) : (
            <button className="btn-primary" onClick={() => navigate('/profile')}>
              Go to Profile
            </button>
          )}
          <button className="btn-outline" onClick={openUpload}>
            Upload PGNs
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="heading-xl">Vault</h1>
          <p className="text-text-secondary text-sm mt-1">
            {games.length} game{games.length === 1 ? '' : 's'} synced. New games
            are added automatically each time you visit.
          </p>
        </div>
        <button className="btn-outline shrink-0" onClick={openUpload}>
          Upload PGNs
        </button>
      </header>

      <div className="card p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by blunders">
          {BLUNDER_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className="pill"
              aria-pressed={blunderFilter === f.key}
              onClick={() => setBlunderFilter(f.key)}
            >
              {f.label}
              <span className="ml-1.5 text-text-secondary/70">{filterCounts[f.key]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            className="input h-9 flex-1 min-w-[10rem]"
            placeholder="Search opponent or opening…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search games"
          />
          <VaultSelect
            value={resultFilter}
            onChange={(e) => setResultFilter(e.target.value as ResultFilter)}
            aria-label="Filter by result"
          >
            <option value="all">Any result</option>
            <option value="win">Wins</option>
            <option value="loss">Losses</option>
            <option value="draw">Draws</option>
          </VaultSelect>
          <VaultSelect
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOrder)}
            aria-label="Sort games"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="blunders">Most blunders</option>
          </VaultSelect>
        </div>
        {filtersActive && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-text-secondary">
              Showing {filteredGames.length} of {games.length} game
              {games.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              className="btn-ghost text-xs h-10 px-3 lg:h-7 lg:px-2 inline-flex items-center gap-1"
              onClick={clearFilters}
            >
              <CloseIcon className="h-3 w-3" />
              Clear filters
            </button>
          </div>
        )}
      </div>

      {filteredGames.length === 0 ? (
        <div className="card text-center flex flex-col items-center gap-3">
          <p className="text-text-secondary text-sm">No games match the current filters.</p>
          <button className="btn-outline" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      ) : (
        <ul className="card divide-y divide-text-primary/15 p-0 overflow-hidden">
          {filteredGames.map((g) => {
            const externalUrl = platformGameUrl(g);
            const outcome = gameOutcome(g);
            const blunderCount = blunderCounts?.[g.id] ?? 0;
            const blunderLabel = !g.analyzedAt
              ? 'Not analyzed'
              : blunderCount === 0
                ? 'No blunders'
                : `${blunderCount} blunder${blunderCount === 1 ? '' : 's'}`;
            const expanded = expandedId === g.id;
            return (
              <li key={g.id}>
                <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium truncate">
                      {orderedPlayers(g.username, g.opponent, g.userColor)[0]}{' '}
                      <span className="text-text-secondary">vs</span>{' '}
                      {orderedPlayers(g.username, g.opponent, g.userColor)[1]}
                    </span>
                    <span className="text-xs text-text-secondary mt-0.5">
                      {g.platform} · {g.timeControl ?? '—'} ·{' '}
                      {g.playedAt ? formatDate(g.playedAt) : 'unknown date'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {blunderCount > 0 ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs text-mistake hover:underline"
                        aria-expanded={expanded}
                        title={expanded ? 'Hide positions' : 'Show blunder positions'}
                        onClick={() => setExpandedId(expanded ? null : g.id)}
                      >
                        {blunderLabel}
                        <ChevronIcon
                          className={clsx(
                            'h-3.5 w-3.5 transition-transform',
                            expanded && 'rotate-90',
                          )}
                        />
                      </button>
                    ) : (
                      <span className="text-xs text-text-secondary">{blunderLabel}</span>
                    )}
                    <ResultBadge outcome={outcome} />
                    {externalUrl ? (
                      <a
                        href={externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={clsx(
                          'btn-ghost text-xs gap-1',
                          analyzedIds.has(g.id) && 'text-text-secondary/70',
                        )}
                        title={`Open analysis on ${g.platform}`}
                        onClick={() => markAnalyzed(g.id)}
                        onAuxClick={(e) => {
                          if (e.button === 1) markAnalyzed(g.id);
                        }}
                      >
                        {analyzedIds.has(g.id) ? 'Re-analyze' : 'Analyze'}{' '}
                        <span aria-hidden>↗</span>
                      </a>
                    ) : (
                      <span
                        className="btn-ghost text-xs gap-1 opacity-40 cursor-not-allowed"
                        title="No external link available"
                      >
                        Analyze <span aria-hidden>↗</span>
                      </span>
                    )}
                    <button
                      type="button"
                      className="btn-ghost text-xs text-text-secondary hover:text-incorrect inline-flex items-center"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteTarget(g);
                      }}
                      title="Delete game and its blunders"
                      aria-label="Delete game"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {expanded && (
                  <GameBlunderThumbs
                    game={g}
                    onPreview={(blunder) => setPreview({ blunder, game: g })}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {preview && (
        <PositionPreviewModal
          blunder={preview.blunder}
          game={preview.game}
          onClose={() => setPreview(null)}
        />
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Delete game"
          onClick={() => !deleting && setDeleteTarget(null)}
        >
          <div
            className="card max-w-md w-full flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2 className="heading-lg">Delete this game?</h2>
            </header>
            <p className="text-text-secondary text-sm">
              This permanently removes{' '}
              <span className="text-text-primary font-medium">
                {orderedPlayers(
                  deleteTarget.username,
                  deleteTarget.opponent,
                  deleteTarget.userColor,
                ).join(' vs ')}
              </span>{' '}
              and any blunders found in it. The positions won't appear in
              training again. This can't be undone.
            </p>
            {deleteError && (
              <div className="bg-incorrect/10 border-2 border-incorrect/50 text-incorrect rounded-none p-3 text-sm">
                {deleteError}
              </div>
            )}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                className="btn-ghost"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary bg-incorrect hover:bg-incorrect border-incorrect inline-flex items-center gap-1.5"
                disabled={deleting}
                onClick={confirmDeleteGame}
              >
                <TrashIcon className="h-4 w-4" />
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The blunder positions are the user's mistakes, so the side to move is the user. */
function blunderOrientation(game: GameRecord, blunder: Blunder): 'white' | 'black' {
  return game.userColor ?? fenSideToMove(blunder.fen);
}

function GameBlunderThumbs({
  game,
  onPreview,
}: {
  game: GameRecord;
  onPreview: (b: Blunder) => void;
}) {
  const { data: blunders, isLoading } = useQuery({
    queryKey: ['gameBlunders', game.id],
    queryFn: () => supabaseService.getBlundersForGames([game.id]),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="px-5 py-4 border-t-2 border-text-primary/10 text-xs text-text-secondary">
        Loading positions…
      </div>
    );
  }
  if (!blunders || blunders.length === 0) {
    return (
      <div className="px-5 py-4 border-t-2 border-text-primary/10 text-xs text-text-secondary">
        No stored positions for this game.
      </div>
    );
  }
  return (
    <div className="px-5 py-4 border-t-2 border-text-primary/10 bg-surface-3/30">
      <div className="flex flex-wrap gap-4">
        {blunders.map((b) => {
          const played = uciToSan(b.fen, b.playedMove) ?? b.playedMove;
          return (
            <button
              key={b.id}
              type="button"
              className="group flex flex-col items-start gap-1.5 text-left"
              onClick={() => onPreview(b)}
              title="Expand position"
            >
              <MiniBoard
                fen={b.fen}
                orientation={blunderOrientation(game, b)}
                className="w-28 transition-transform group-hover:-translate-y-0.5"
              />
              <span className="font-mono text-[10px] uppercase tracking-tight text-text-secondary">
                Move {b.moveNumber} ·{' '}
                {/* SAN is case-sensitive (Nxd5 ≠ NXD5) — undo the label uppercasing */}
                <span className="text-mistake normal-case">{played}?</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PositionPreviewModal({
  blunder,
  game,
  onClose,
}: {
  blunder: Blunder;
  game: GameRecord;
  onClose: () => void;
}) {
  const played = uciToSan(blunder.fen, blunder.playedMove) ?? blunder.playedMove;
  const bestUci = blunder.correctMoves[0]?.move;
  const best = bestUci ? (uciToSan(blunder.fen, bestUci) ?? bestUci) : null;
  const sideToMove = fenSideToMove(blunder.fen);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Blunder position"
      onClick={onClose}
    >
      <div
        className="card max-w-sm w-full flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="heading-md">Move {blunder.moveNumber}</h2>
            <p className="text-xs text-text-secondary mt-0.5">
              {sideToMove === 'white' ? 'White' : 'Black'} to move ·{' '}
              {orderedPlayers(game.username, game.opponent, game.userColor).join(' vs ')}
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost h-8 px-2 shrink-0"
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </header>
        <MiniBoard
          fen={blunder.fen}
          orientation={blunderOrientation(game, blunder)}
          className="w-full"
        />
        <div className="flex flex-col gap-1.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="label">Played</span>
            <span className="font-mono text-incorrect">{played}?</span>
          </div>
          {best && (
            <div className="flex items-center justify-between gap-3">
              <span className="label">Best</span>
              <span className="font-mono text-correct">{best}</span>
            </div>
          )}
          {blunder.motifs.length > 0 && (
            <div className="flex items-center justify-between gap-3">
              <span className="label">Motifs</span>
              <span className="flex flex-wrap justify-end gap-1.5">
                {blunder.motifs.map((m) => (
                  <span
                    key={m}
                    className="px-1.5 py-0.5 border-2 border-text-primary/30 font-mono text-[10px] uppercase tracking-tight text-text-secondary"
                  >
                    {MOTIF_LABEL[m]}
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultBadge({ outcome }: { outcome: Outcome | null }) {
  const map = {
    win: { letter: 'W', cls: 'bg-correct/20 text-correct border-correct/50' },
    loss: { letter: 'L', cls: 'bg-incorrect/20 text-incorrect border-incorrect/50' },
    draw: { letter: 'D', cls: 'bg-surface-3 text-text-secondary border-text-primary' },
  } as const;
  const meta = outcome ? map[outcome] : null;
  return (
    <span
      className={clsx(
        'inline-flex items-center justify-center w-6 h-6 rounded-none border-2 font-mono text-xs font-bold',
        meta?.cls ?? 'bg-surface-3 text-text-secondary border-text-primary',
      )}
      title={outcome ?? 'unknown result'}
    >
      {meta?.letter ?? '–'}
    </span>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
