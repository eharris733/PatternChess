import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../../auth/useAuth';
import { useGames } from '../../hooks/useGames';
import { supabaseService } from '../../services/supabaseService';
import { fenSideToMove, uciToSan } from '../../chess/moveUtils';
import { MOTIF_LABEL, type Motif } from '../../chess/motifs';
import {
  DRILL_KIND_LABEL,
  SR_BUCKET_LABEL,
  SPACED_REPETITION_DAYS,
  srBucket,
  type Blunder,
  type DrillKind,
} from '../../models/blunder';
import type { GameRecord } from '../../models/gameRecord';
import { MiniBoard } from '../MiniBoard';
import { MasteryDots } from '../MasteryDots';
import { ShareIcon } from '../icons/ShareIcon';
import { Skeleton } from '../Skeleton';
import { SR_BUCKET_PILL } from '../training/PositionSrState';
import { PositionShareModal } from '../share/PositionShareModal';
import { PositionPreviewModal } from './PositionPreviewModal';
import { blunderOrientation, formatDate } from './vaultHelpers';
import { VaultFilterBar } from './VaultFilterBar';
import { VaultExportMenu } from './VaultExportMenu';
import {
  clearFilterParams,
  effectiveFilters,
  matchesFilters,
  positionFacts,
  readFilters,
  writeFilters,
  type PositionFilters,
} from './vaultFilters';
import { useLabel, useT, type Translator } from '../../i18n/useT';

export type PositionsMode = 'blunders' | 'mastered';

const PAGE = 24;
const BLUNDER_KINDS: readonly DrillKind[] = ['tactic', 'endgame'];

/** Every live trainable position (all kinds), newest first. */
export function useVaultPositions() {
  const { user } = useAuth();
  return useQuery({
    // Under ['blunders'] so drills, deletes and re-analysis refresh it.
    queryKey: ['blunders', 'vault', user?.id],
    queryFn: () => supabaseService.getAllLiveBlunders(),
    enabled: !!user,
    staleTime: 60_000,
  });
}

function positionTitle(b: Blunder, t: Translator): string {
  if (b.kind === 'opening' && b.drillData && 'openingName' in b.drillData) {
    const name = b.drillData.openingName ?? b.drillData.openingFamily;
    if (name) return name;
  }
  const san = uciToSan(b.fen, b.playedMove) ?? b.playedMove;
  return t('vault.pos.title', { move: b.moveNumber, san });
}

/**
 * Blunders (tactics + endgame slips) or mastered positions (every kind) as a
 * board grid — each one trainable on demand and shareable. Filters live in
 * the URL (see vaultFilters.ts) and Export takes exactly the filtered set.
 */
export function VaultPositionsTab({ mode }: { mode: PositionsMode }) {
  const t = useT();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const positions = useVaultPositions();
  const { data: games } = useGames();
  const gameById = useMemo(() => new Map((games ?? []).map((g) => [g.id, g])), [games]);

  const [shown, setShown] = useState(PAGE);
  const [preview, setPreview] = useState<Blunder | null>(null);
  const [sharing, setSharing] = useState<Blunder | null>(null);

  const paramKey = params.toString();
  const filters = useMemo(
    () => effectiveFilters(readFilters(new URLSearchParams(paramKey)), mode),
    [paramKey, mode],
  );
  const setFilters = (patch: Partial<PositionFilters>) =>
    setParams((prev) => writeFilters(prev, patch), { replace: true });
  const clearFilters = () => setParams((prev) => clearFilterParams(prev), { replace: true });
  // A new filter starts from the top of the list.
  useEffect(() => setShown(PAGE), [paramKey]);

  const pool = useMemo(
    () =>
      (positions.data ?? [])
        .filter((b) => (mode === 'mastered' ? srBucket(b) === 'mastered' : BLUNDER_KINDS.includes(b.kind)))
        .map((b) => positionFacts(b, b.gameId ? (gameById.get(b.gameId) ?? null) : null)),
    [positions.data, mode, gameById],
  );
  const items = useMemo(() => pool.filter((f) => matchesFilters(f, filters)), [pool, filters]);

  const train = (b: Blunder) =>
    navigate('/training', { state: { blunderIds: [b.id], focusLabel: positionTitle(b, t) } });

  if (positions.isPending) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-72 w-full" />
        ))}
      </div>
    );
  }
  if (positions.isError) {
    return <p className="text-text-primary text-sm">{t('vault.pos.loadError')}</p>;
  }
  if (pool.length === 0) {
    return (
      <div className="card flex flex-col gap-2" data-testid={`vault-${mode}-empty`}>
        <h2 className="heading-md">{mode === 'mastered' ? t('vault.pos.noneMastered') : t('vault.pos.noBlunders')}</h2>
        <p className="text-text-primary text-sm">
          {mode === 'mastered'
            ? t('vault.pos.masteredHelp', { count: SPACED_REPETITION_DAYS.length })
            : t('vault.pos.blundersHelp')}
        </p>
        <button type="button" className="pill self-start" onClick={() => navigate('/training')}>
          {t('vault.pos.goTraining')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <VaultFilterBar mode={mode} facts={pool} filters={filters} onChange={setFilters} onClear={clearFilters} />
      <div className="flex items-center justify-between gap-3">
        <p className="text-text-primary text-sm" data-testid="vault-count">
          {t('vault.pos.count', { count: items.length })}
          {items.length !== pool.length && ` ${t('vault.pos.ofTotal', { total: pool.length })}`}
        </p>
        <VaultExportMenu mode={mode} items={items} />
      </div>

      {items.length === 0 && (
        <div className="card flex flex-col items-start gap-2" data-testid="vault-no-matches">
          <p className="text-text-primary text-sm">{t('vault.pos.noMatches')}</p>
          <button type="button" className="pill" onClick={clearFilters}>
            {t('vault.filter.clear')}
          </button>
        </div>
      )}

      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid={`vault-${mode}-list`}>
        {items.slice(0, shown).map(({ blunder: b, game }) => (
          <PositionCard
            key={b.id}
            blunder={b}
            game={game}
            activeMotif={filters.motif}
            onPreview={() => setPreview(b)}
            onTrain={() => train(b)}
            onShare={() => setSharing(b)}
            onMotif={(m) => setFilters({ motif: filters.motif === m ? null : m })}
          />
        ))}
      </ul>
      {items.length > shown && (
        <button type="button" className="btn-outline self-center" onClick={() => setShown((n) => n + PAGE)}>
          {t('vault.showMoreLeft', { count: items.length - shown })}
        </button>
      )}

      {preview && (
        <PositionPreviewModal
          blunder={preview}
          game={preview.gameId ? (gameById.get(preview.gameId) ?? null) : null}
          onClose={() => setPreview(null)}
        />
      )}
      {sharing && (
        <PositionShareModal
          blunder={sharing}
          game={sharing.gameId ? (gameById.get(sharing.gameId) ?? null) : null}
          onClose={() => setSharing(null)}
        />
      )}
    </div>
  );
}

function PositionCard({
  blunder,
  game,
  activeMotif,
  onPreview,
  onTrain,
  onShare,
  onMotif,
}: {
  blunder: Blunder;
  game: GameRecord | null;
  activeMotif: Motif | null;
  onPreview: () => void;
  onTrain: () => void;
  onShare: () => void;
  onMotif: (m: Motif) => void;
}) {
  const t = useT();
  const label = useLabel();
  const bucket = srBucket(blunder);
  const orientation = game ? blunderOrientation(game, blunder) : fenSideToMove(blunder.fen);
  return (
    <li className="card p-3 flex flex-col gap-2" data-testid="vault-position">
      <button type="button" onClick={onPreview} aria-label={t('vault.pos.preview', { title: positionTitle(blunder, t) })}>
        <MiniBoard fen={blunder.fen} orientation={orientation} className="w-full" />
      </button>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary truncate">{positionTitle(blunder, t)}</p>
          <p className="text-xs text-text-primary truncate">
            {label('drillKind', blunder.kind, DRILL_KIND_LABEL[blunder.kind])}
            {game && ` · ${t('vault.pos.vs', { name: game.opponent })}`}
            {game?.playedAt && ` · ${formatDate(game.playedAt)}`}
          </p>
        </div>
        <span
          className={clsx(
            'shrink-0 px-1.5 py-0.5 border-2 font-mono text-[10px] uppercase tracking-tight',
            SR_BUCKET_PILL[bucket],
          )}
        >
          {label('srBucket', bucket, SR_BUCKET_LABEL[bucket])}
        </span>
      </div>
      {blunder.motifs.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label={t('vault.pos.motifs')} data-testid="vault-position-motifs">
          {blunder.motifs.map((m) => (
            <li key={m}>
              <button
                type="button"
                aria-pressed={activeMotif === m}
                onClick={() => onMotif(m)}
                className={clsx(
                  'px-1.5 py-0.5 border-2 font-mono text-[10px] uppercase tracking-tight text-text-primary transition-colors',
                  activeMotif === m ? 'border-accent bg-accent/15' : 'border-text-primary/30 hover:bg-accent/15',
                )}
              >
                {label('motif', m, MOTIF_LABEL[m])}
              </button>
            </li>
          ))}
        </ul>
      )}
      <MasteryDots cycleNumber={blunder.cycleNumber} size="sm" />
      {/* Bottom-aligned so cards with and without motif chips line up. */}
      <div className="flex gap-2 mt-auto">
        <button type="button" className="btn-primary flex-1" onClick={onTrain}>
          {t('common.train')}
        </button>
        <button type="button" className="btn-outline inline-flex items-center gap-1.5" onClick={onShare}>
          <ShareIcon className="h-4 w-4" />
          {t('vault.share')}
        </button>
      </div>
    </li>
  );
}
