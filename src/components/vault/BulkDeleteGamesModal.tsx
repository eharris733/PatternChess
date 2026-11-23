import { useMemo, useState } from 'react';
import { supabaseService } from '../../services/supabaseService';
import type { GameRecord } from '../../models/gameRecord';
import { TrashIcon } from '../icons/TrashIcon';
import { gameSortTime } from './vaultHelpers';
import { useT } from '../../i18n/useT';

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
  const t = useT();
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
          t('vault.bulk.partial', { deleted, total: n }),
        );
        return;
      }
      onClose();
    } catch (err) {
      console.error('Bulk delete failed', err);
      setError(err instanceof Error ? err.message : t('train.deleteFailed'));
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
      aria-label={t('vault.bulk.title')}
      onClick={() => !deleting && onClose()}
    >
      <div
        className="card max-w-md w-full flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2 className="heading-lg">{t('vault.bulk.title')}</h2>
        </header>

        <fieldset className="flex flex-col gap-3" disabled={deleting}>
          <legend className="sr-only">{t('vault.bulk.which')}</legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="bulk-delete-mode"
              className="mt-1"
              checked={mode === 'before'}
              onChange={() => setMode('before')}
            />
            <span className="flex flex-col gap-2">
              {t('vault.bulk.before')}
              <input
                type="date"
                className="input h-9 w-44"
                value={before}
                onChange={(e) => {
                  setBefore(e.target.value);
                  setMode('before');
                }}
                aria-label={t('vault.bulk.beforeAria')}
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
            {t('vault.bulk.all', { count: games.length })}
          </label>
        </fieldset>

        <p className="text-text-primary text-sm">
          {n === 0
            ? mode === 'before' && !before
              ? t('vault.bulk.pickDate')
              : t('vault.bulk.noMatch')
            : t('vault.bulk.body', { count: n })}
        </p>

        {error && (
          <div className="bg-incorrect/10 border-2 border-incorrect/50 text-incorrect rounded-none p-3 text-sm">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          <button type="button" className="btn-ghost" disabled={deleting} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn-primary bg-incorrect hover:bg-incorrect border-incorrect inline-flex items-center gap-1.5"
            disabled={deleting || n === 0}
            onClick={confirm}
          >
            <TrashIcon className="h-4 w-4" />
            {deleting ? t('vault.bulk.deleting', { done: progress, total: n }) : t('vault.bulk.action', { count: n })}
          </button>
        </div>
      </div>
    </div>
  );
}
