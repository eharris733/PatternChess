import { useEffect } from 'react';
import { Skeleton } from '../Skeleton';
import { StageBadge } from '../../routes/AnalyticsRoute';
import {
  useAdminUserList,
  type AdminUserCategory,
  type AdminUserRow,
} from '../../hooks/useAdminUserList';
import {
  chesscomProfileUrl,
  lichessProfileUrl,
} from '../../lib/chessProfileUrl';

const CATEGORY_LABEL: Record<AdminUserCategory, string> = {
  signups: 'Signups',
  connected: 'Connected accounts',
  synced: 'Synced games',
  foundBlunders: 'Found blunders',
  trained: 'Trained',
  dau: 'Active in last 24h',
  wau: 'Active in last 7 days',
  mau: 'Active in last 30 days',
};

export interface UserListModalProps {
  category: AdminUserCategory;
  onClose: () => void;
}

export function UserListModal({ category, onClose }: UserListModalProps) {
  const { data: rows, isPending, isError, error } = useAdminUserList(category);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const title = CATEGORY_LABEL[category];
  const count = rows?.length ?? 0;
  const capped = count >= 500;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="card max-w-3xl w-full flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-baseline justify-between gap-3">
          <div className="flex flex-col gap-0.5 min-w-0">
            <h2 className="heading-lg">{title}</h2>
            {!isPending && !isError && (
              <span className="text-text-secondary text-xs">
                {count.toLocaleString()} user{count === 1 ? '' : 's'}
                {capped ? ' · latest 500' : ''}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary shrink-0"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        {isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {isError && (
          <p className="text-incorrect text-sm">
            Couldn't load users: {(error as Error)?.message ?? 'unknown error'}
          </p>
        )}

        {!isPending && !isError && count === 0 && (
          <p className="text-text-secondary text-sm">No users in this bucket yet.</p>
        )}

        {!isPending && !isError && count > 0 && (
          <div className="flex flex-col divide-y-2 divide-text-primary/10">
            {rows!.map((r, i) => (
              <UserRow key={`${r.email ?? 'anon'}-${i}`} row={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UserRow({ row }: { row: AdminUserRow }) {
  const handles: { href: string; label: string }[] = [];
  if (row.lichessUsername)
    handles.push({
      href: lichessProfileUrl(row.lichessUsername),
      label: `lichess.org/@/${row.lichessUsername}`,
    });
  if (row.chesscomUsername)
    handles.push({
      href: chesscomProfileUrl(row.chesscomUsername),
      label: `chess.com/member/${row.chesscomUsername}`,
    });

  return (
    <div className="flex flex-col gap-1.5 py-3 first:pt-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-text-primary text-sm truncate">
          {row.email ?? row.displayName ?? 'unknown'}
        </span>
        <span className="text-text-secondary text-xs tabular-nums shrink-0">
          {row.lastActive ? `active ${formatShortDate(row.lastActive)}` : 'never active'}
        </span>
      </div>

      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-text-primary tabular-nums">
          {row.trainingSessions > 0 ? (
            <>
              <span className="font-semibold">{row.trainingSessions}</span>{' '}
              session{row.trainingSessions === 1 ? '' : 's'}
              {row.lastSessionAt && (
                <span className="text-text-secondary">
                  {' '}· last {formatShortDate(row.lastSessionAt)}
                </span>
              )}
            </>
          ) : (
            <span className="text-text-secondary">— no training sessions</span>
          )}
        </span>
        <span className="text-text-secondary tabular-nums shrink-0">
          signed up {formatShortDate(row.createdAt)}
        </span>
      </div>

      {(row.games > 0 || row.blunders > 0) && (
        <div className="text-text-secondary text-xs tabular-nums">
          {row.games.toLocaleString()} game{row.games === 1 ? '' : 's'} ·{' '}
          {row.blunders.toLocaleString()} blunder{row.blunders === 1 ? '' : 's'}
        </div>
      )}

      {handles.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {handles.map((h) => (
            <a
              key={h.href}
              href={h.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-secondary text-[11px] truncate hover:text-text-primary underline-offset-2 hover:underline"
            >
              {h.label}
            </a>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        <StageBadge on={row.connected} label="Connected" />
        <StageBadge on={row.synced} label="Synced" />
        <StageBadge on={row.foundBlunders} label="Blunders" />
        <StageBadge on={row.trained} label="Trained" />
      </div>
    </div>
  );
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}
