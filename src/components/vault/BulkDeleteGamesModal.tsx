import { useMemo, useState } from 'react';
import { supabaseService } from '../../services/supabaseService';
import type { GameRecord } from '../../models/gameRecord';
import { TrashIcon } from '../icons/TrashIcon';
import { gameSortTime } from './vaultHelpers';

type Mode = 'before' | 'all';

/**
 * "Delete games…" from the Vault Games tab: everything played before a date,
 * or every game. Blunders and the rest of a game's data go with it.
 */
export function BulkDeleteGamesModal({
  games,
  onClose,
  onDeleted,
}: {
  games: GameRecord[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [mode, setMode] = useState<Mode>('before');
  const [before, setBefore] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const targets = useMemo(() => {
    if (mode === 'all') return games;
    if (!before) return [];
    // Local midnight of the chosen day: "before 1 March" keeps 1 March.
    const cutoff = new Date(`${before}T00:00:00`).getTime();
    if (Number.isNaN(cutoff)) return [];
    return games.filter((g) => gameSortTime(g) < cutoff);
  }, [games, mode, before]);

  const n = targets.length;

  const confirm = async () => {
    if (n === 0) return;
    setDeleting(true);
    setError(null);
    setProgress(0);
    try {
      const deleted = await supabaseService.deleteGames(
        targets.map((g) => g.id),
        setProgress,
      );
      onDeleted();
      if (deleted < n) {
        setError(
          `${deleted} of ${n} games were deleted. The rest couldn't be removed — it may be a permissions issue.`,
        );
        return;
      }
      onClose();
    } catch (err) {
      console.error('Bulk delete failed', err);
      setError(err instanceof Error ? err.message : 'Delete failed.');
      onDeleted();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Delete games"
      onClick={() => !deleting && onClose()}
    >
      <div
        className="card max-w-md w-full flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2 className="heading-lg">Delete games</h2>
        </header>

        <fieldset className="flex flex-col gap-3" disabled={deleting}>
          <legend className="sr-only">Which games</legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="bulk-delete-mode"
              className="mt-1"
              checked={mode === 'before'}
              onChange={() => setMode('before')}
            />
            <span className="flex flex-col gap-2">
              Games played before
              <input
                type="date"
                className="input h-9 w-44"
                value={before}
                onChange={(e) => {
                  setBefore(e.target.value);
                  setMode('before');
                }}
                aria-label="Delete games played before this date"
              />
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="bulk-delete-mode"
              checked={mode === 'all'}
              onChange={() => setMode('all')}
            />
            All {games.length} games
          </label>
        </fieldset>

        <p className="text-text-primary text-sm">
          {n === 0
            ? mode === 'before' && !before
              ? 'Pick a date to see how many games that removes.'
              : 'No games match.'
            : `This permanently removes ${n} game${n === 1 ? '' : 's'} and every position found in ${
                n === 1 ? 'it' : 'them'
              }, including your training progress on those positions. This can't be undone.`}
        </p>

        {error && (
          <div className="bg-incorrect/10 border-2 border-incorrect/50 text-incorrect rounded-none p-3 text-sm">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          <button type="button" className="btn-ghost" disabled={deleting} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary bg-incorrect hover:bg-incorrect border-incorrect inline-flex items-center gap-1.5"
            disabled={deleting || n === 0}
            onClick={confirm}
          >
            <TrashIcon className="h-4 w-4" />
            {deleting ? `Deleting ${progress}/${n}…` : `Delete ${n} game${n === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
