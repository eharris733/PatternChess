import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../../auth/useAuth';
import { useGames } from '../../hooks/useGames';
import { supabaseService } from '../../services/supabaseService';
import { fenSideToMove, uciToSan } from '../../chess/moveUtils';
import {
  DRILL_KIND_LABEL,
  SR_BUCKET_LABEL,
  SR_BUCKET_ORDER,
  SPACED_REPETITION_DAYS,
  srBucket,
  type Blunder,
  type DrillKind,
  type SrBucket,
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

function positionTitle(b: Blunder): string {
  if (b.kind === 'opening' && b.drillData && 'openingName' in b.drillData) {
    const name = b.drillData.openingName ?? b.drillData.openingFamily;
    if (name) return name;
  }
  const san = uciToSan(b.fen, b.playedMove) ?? b.playedMove;
  return `Move ${b.moveNumber} · ${san}?`;
}

/**
 * Blunders (tactics + endgame slips) or mastered positions (every kind) as a
 * board grid — each one trainable on demand and shareable.
 */
export function VaultPositionsTab({ mode }: { mode: PositionsMode }) {
  const navigate = useNavigate();
  const positions = useVaultPositions();
  const { data: games } = useGames();
  const gameById = useMemo(() => new Map((games ?? []).map((g) => [g.id, g])), [games]);

  const [kind, setKind] = useState<DrillKind | 'all'>('all');
  const [bucket, setBucket] = useState<SrBucket | 'all'>('all');
  const [shown, setShown] = useState(PAGE);
  const [preview, setPreview] = useState<Blunder | null>(null);
  const [sharing, setSharing] = useState<Blunder | null>(null);

  const pool = useMemo(
    () =>
      (positions.data ?? []).filter((b) =>
        mode === 'mastered' ? srBucket(b) === 'mastered' : BLUNDER_KINDS.includes(b.kind),
      ),
    [positions.data, mode],
  );
  const kindsPresent = useMemo(() => {
    const set = new Set(pool.map((b) => b.kind));
    return (['tactic', 'endgame', 'opening'] as const).filter((k) => set.has(k));
  }, [pool]);
  const bucketCounts = useMemo(() => {
    const counts = {} as Record<SrBucket, number>;
    for (const k of SR_BUCKET_ORDER) counts[k] = 0;
    for (const b of pool) if (kind === 'all' || b.kind === kind) counts[srBucket(b)]++;
    return counts;
  }, [pool, kind]);
  const items = useMemo(
    () =>
      pool.filter(
        (b) => (kind === 'all' || b.kind === kind) && (mode === 'mastered' || bucket === 'all' || srBucket(b) === bucket),
      ),
    [pool, kind, bucket, mode],
  );

  const train = (b: Blunder) =>
    navigate('/training', { state: { blunderIds: [b.id], focusLabel: positionTitle(b) } });

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
    return <p className="text-text-primary text-sm">Couldn't load your positions. Try again later.</p>;
  }
  if (pool.length === 0) {
    return (
      <div className="card flex flex-col gap-2" data-testid={`vault-${mode}-empty`}>
        <h2 className="heading-md">{mode === 'mastered' ? 'Nothing mastered yet' : 'No blunders yet'}</h2>
        <p className="text-text-primary text-sm">
          {mode === 'mastered'
            ? `A position is mastered once you've solved it on ${SPACED_REPETITION_DAYS.length} spaced reviews in a row. Keep training and they will collect here.`
            : 'Blunders found in your analyzed games show up here.'}
        </p>
        <button type="button" className="pill self-start" onClick={() => navigate('/training')}>
          Go to training
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {kindsPresent.length > 1 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by type">
            <button type="button" className="pill" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>
              All<span className="ml-1.5 text-text-secondary/70">{pool.length}</span>
            </button>
            {kindsPresent.map((k) => (
              <button key={k} type="button" className="pill" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {DRILL_KIND_LABEL[k]}
                <span className="ml-1.5 text-text-secondary/70">{pool.filter((b) => b.kind === k).length}</span>
              </button>
            ))}
          </div>
        )}
        {mode === 'blunders' && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by progress">
            <button type="button" className="pill" aria-pressed={bucket === 'all'} onClick={() => setBucket('all')}>
              Any progress
            </button>
            {SR_BUCKET_ORDER.map((k) => (
              <button key={k} type="button" className="pill" aria-pressed={bucket === k} onClick={() => setBucket(k)}>
                {SR_BUCKET_LABEL[k]}
                <span className="ml-1.5 text-text-secondary/70">{bucketCounts[k]}</span>
              </button>
            ))}
          </div>
        )}
        <p className="text-text-primary text-sm">
          {items.length} {items.length === 1 ? 'position' : 'positions'}
        </p>
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid={`vault-${mode}-list`}>
        {items.slice(0, shown).map((b) => (
          <PositionCard
            key={b.id}
            blunder={b}
            game={b.gameId ? (gameById.get(b.gameId) ?? null) : null}
            onPreview={() => setPreview(b)}
            onTrain={() => train(b)}
            onShare={() => setSharing(b)}
          />
        ))}
      </ul>
      {items.length > shown && (
        <button type="button" className="btn-outline self-center" onClick={() => setShown((n) => n + PAGE)}>
          Show more ({items.length - shown} left)
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
  onPreview,
  onTrain,
  onShare,
}: {
  blunder: Blunder;
  game: GameRecord | null;
  onPreview: () => void;
  onTrain: () => void;
  onShare: () => void;
}) {
  const bucket = srBucket(blunder);
  const orientation = game ? blunderOrientation(game, blunder) : fenSideToMove(blunder.fen);
  return (
    <li className="card p-3 flex flex-col gap-2" data-testid="vault-position">
      <button type="button" onClick={onPreview} aria-label={`Preview ${positionTitle(blunder)}`}>
        <MiniBoard fen={blunder.fen} orientation={orientation} className="w-full" />
      </button>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary truncate">{positionTitle(blunder)}</p>
          <p className="text-xs text-text-primary truncate">
            {DRILL_KIND_LABEL[blunder.kind]}
            {game && ` · vs ${game.opponent}`}
            {game?.playedAt && ` · ${formatDate(game.playedAt)}`}
          </p>
        </div>
        <span
          className={clsx(
            'shrink-0 px-1.5 py-0.5 border-2 font-mono text-[10px] uppercase tracking-tight',
            SR_BUCKET_PILL[bucket],
          )}
        >
          {SR_BUCKET_LABEL[bucket]}
        </span>
      </div>
      <MasteryDots cycleNumber={blunder.cycleNumber} size="sm" />
      <div className="flex gap-2">
        <button type="button" className="btn-primary flex-1" onClick={onTrain}>
          Train
        </button>
        <button type="button" className="btn-outline inline-flex items-center gap-1.5" onClick={onShare}>
          <ShareIcon className="h-4 w-4" />
          Share
        </button>
      </div>
    </li>
  );
}
