import { useEffect, useRef, useState } from 'react';
import { supabaseService } from '../../services/supabaseService';
import { downloadBlob } from '../../share/shareFile';
import { DownloadIcon } from '../icons/DownloadIcon';
import { exportFilename, positionsToCsv, positionsToPgn } from './vaultExport';
import type { PositionFacts } from './vaultFilters';
import type { PositionsMode } from './VaultPositionsTab';
import { useT } from '../../i18n/useT';
import type { MessageKey } from '../../i18n/i18n';

type Format = 'csv' | 'pgn';

const FORMATS: Array<{ id: Format; label: string; detail: MessageKey }> = [
  { id: 'csv', label: 'CSV', detail: 'vault.export.csvDetail' },
  { id: 'pgn', label: 'PGN', detail: 'vault.export.pgnDetail' },
];

/** Export menu for the Blunders / Mastered tabs: exactly the positions the filters show. */
export function VaultExportMenu({ mode, items }: { mode: PositionsMode; items: readonly PositionFacts[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = async (format: Format) => {
    setBusy(format);
    setError(null);
    try {
      const gameIds = items.map((f) => f.blunder.gameId).filter((id): id is string => !!id);
      const links = await supabaseService.getGameLinks(gameIds);
      const rows = items.map((facts) => ({
        facts,
        link: facts.blunder.gameId ? (links.get(facts.blunder.gameId) ?? null) : null,
      }));
      const blob =
        format === 'csv'
          ? new Blob([positionsToCsv(rows)], { type: 'text/csv;charset=utf-8' })
          : new Blob([positionsToPgn(rows)], { type: 'application/x-chess-pgn' });
      downloadBlob(blob, exportFilename(mode, format));
      setOpen(false);
    } catch (err) {
      console.warn('[vault] export failed', err);
      setError(t('vault.export.error'));
    } finally {
      setBusy(null);
    }
  };

  const count = items.length;
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="btn-outline h-9 inline-flex items-center gap-1.5"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={count === 0}
        data-testid="vault-export"
        onClick={() => {
          setError(null);
          setOpen((o) => !o);
        }}
      >
        <DownloadIcon className="h-4 w-4" />
        {t('vault.export.label')}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t('vault.export.menu')}
          className="card absolute top-full right-0 mt-2 z-30 w-64 flex flex-col gap-1 p-2 shadow-lg"
        >
          <p className="label px-2 pt-1">
            {t('vault.export.title', { count })}
          </p>
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="menuitem"
              data-testid={`vault-export-${f.id}`}
              disabled={busy !== null}
              onClick={() => void run(f.id)}
              className="text-left px-2 py-2 hover:bg-accent/15 disabled:opacity-60"
            >
              <span className="block text-sm font-semibold text-text-primary">
                {busy === f.id ? t('vault.export.preparing') : f.label}
              </span>
              <span className="block text-sm text-text-primary">{t(f.detail)}</span>
            </button>
          ))}
          {error && (
            <p role="alert" className="text-incorrect text-xs px-2 pb-1">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
