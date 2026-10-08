import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { REPERTOIRE_QUERY_KEY, useRepertoire } from '../../hooks/useRepertoire';
import { classifyPosition, loadOpeningBook } from '../../chess/openingClassifier';
import { parseUciMove } from '../../chess/moveUtils';
import { inviteUrl } from '../../lib/referral';
import type { RepertoireColor, RepertoireMove } from '../../models/repertoire';
import { supabaseService } from '../../services/supabaseService';
import { recordShare } from '../../share/recordShare';
import { MiniBoard } from '../MiniBoard';
import { Skeleton } from '../Skeleton';
import { CloseIcon } from '../icons/CloseIcon';
import { ShareIcon } from '../icons/ShareIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { ImageShareActions } from '../share/ImageShareActions';
import { ShareImagePreview } from '../share/ShareImagePreview';
import { useRenderedImage } from '../share/useRenderedImage';

/** Board + caption bar + footer bar (boardCanvas layout: 8 + 0.8 + 0.85 squares tall). */
const SHARE_IMAGE_ASPECT = 8 / 9.65;
const COLOR_LABEL: Record<RepertoireColor, string> = { white: 'As White', black: 'As Black' };

const fenOf = (m: RepertoireMove) => `${m.epd} 0 1`;

/** Book names for each saved position (after the move when named, else before). */
function useRepertoireNames(moves: RepertoireMove[]) {
  return useQuery({
    queryKey: ['repertoire', 'names', moves.map((m) => m.id).join(',')],
    enabled: moves.length > 0,
    staleTime: Infinity,
    queryFn: async () => {
      const book = await loadOpeningBook();
      const { Chess } = await import('chess.js');
      const names = new Map<string, string>();
      for (const m of moves) {
        let after: string | null = null;
        try {
          const board = new Chess(fenOf(m));
          board.move(m.san);
          after = board.fen();
        } catch {
          // Unplayable (stale row): fall back to the position itself.
        }
        const hit = (after && classifyPosition(book, after)) || classifyPosition(book, fenOf(m));
        if (hit) names.set(m.id, hit.name);
      }
      return names;
    },
  });
}

/** Your saved repertoire moves, by colour — each shareable as an image. */
export function VaultRepertoireTab() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const repertoire = useRepertoire();
  const moves = useMemo(
    () => [...(repertoire.data?.values() ?? [])].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    [repertoire.data],
  );
  const names = useRepertoireNames(moves);
  const [sharing, setSharing] = useState<RepertoireMove | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const remove = async (m: RepertoireMove) => {
    setRemoveError(null);
    try {
      await supabaseService.deleteRepertoireMove(m.id);
      qc.setQueryData<Map<string, RepertoireMove>>([...REPERTOIRE_QUERY_KEY, user?.id], (prev) => {
        const next = new Map(prev ?? []);
        next.delete(`${m.color}|${m.epd}`);
        return next;
      });
    } catch (err) {
      console.warn('[vault] remove repertoire move failed', err);
      setRemoveError("Couldn't remove that move. Try again.");
    }
  };

  if (repertoire.isPending) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-72 w-full" />
        ))}
      </div>
    );
  }
  if (repertoire.isError) {
    return <p className="text-text-primary text-sm">Couldn't load your repertoire. Try again later.</p>;
  }
  if (moves.length === 0) {
    return (
      <div className="card flex flex-col gap-2" data-testid="vault-repertoire-empty">
        <h2 className="heading-md">Your repertoire is empty</h2>
        <p className="text-text-primary text-sm">
          When you solve an opening drill, choose <span className="font-medium">Add to repertoire</span> to save
          that move as your answer. Saved moves collect here.
        </p>
        <button type="button" className="pill self-start" onClick={() => navigate('/openings')}>
          Go to openings
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {removeError && <p className="text-incorrect text-sm">{removeError}</p>}
      {(['white', 'black'] as const).map((color) => {
        const list = moves.filter((m) => m.color === color);
        if (list.length === 0) return null;
        return (
          <section key={color} className="flex flex-col gap-3">
            <h2 className="heading-md">
              {COLOR_LABEL[color]} <span className="text-text-primary text-sm font-normal">· {list.length}</span>
            </h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid={`vault-repertoire-${color}`}>
              {list.map((m) => (
                <li key={m.id} className="card p-3 flex flex-col gap-2" data-testid="vault-repertoire-move">
                  <MiniBoard fen={fenOf(m)} orientation={m.color} className="w-full" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary">
                      You play <span className="font-mono">{m.san}</span>
                    </p>
                    {names.data?.get(m.id) && (
                      <p className="text-xs text-text-primary truncate">{names.data.get(m.id)}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-outline flex-1 inline-flex items-center justify-center gap-1.5"
                      onClick={() => setSharing(m)}
                    >
                      <ShareIcon className="h-4 w-4" />
                      Share
                    </button>
                    <button
                      type="button"
                      className="btn-ghost inline-flex items-center gap-1.5"
                      aria-label={`Remove ${m.san} from your repertoire`}
                      onClick={() => void remove(m)}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {sharing && (
        <RepertoireShareModal move={sharing} openingName={names.data?.get(sharing.id) ?? null} onClose={() => setSharing(null)} />
      )}
    </div>
  );
}

function RepertoireShareModal({
  move,
  openingName,
  onClose,
}: {
  move: RepertoireMove;
  openingName: string | null;
  onClose: () => void;
}) {
  const { profile, refreshProfile } = useAuth();
  const caption = `My repertoire as ${move.color === 'white' ? 'White' : 'Black'}: ${move.san}`;
  const parsed = parseUciMove(move.uci);
  const image = useRenderedImage(move.id, async () => {
    const { renderBoardPng } = await import('../../share/boardCanvas');
    return renderBoardPng(
      { fen: fenOf(move), arrow: parsed ? { from: parsed.from, to: parsed.to } : null },
      { size: 640, orientation: move.color, caption },
    );
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Share this repertoire move"
      onClick={onClose}
    >
      <div
        className="card relative max-w-md w-full flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close"
          className="btn-ghost absolute top-3 right-3 p-1 text-text-primary"
          onClick={onClose}
        >
          <CloseIcon className="h-5 w-5" />
        </button>
        <h2 className="heading-lg text-center">Share this move</h2>
        <div className="max-w-[300px] w-full mx-auto">
          <ShareImagePreview image={image} aspect={SHARE_IMAGE_ASPECT} />
        </div>
        {openingName && <p className="text-text-primary text-xs text-center">{openingName}</p>}
        <ImageShareActions
          blob={image.blob}
          filename="patternchess-repertoire.png"
          title="My repertoire"
          shareText={`${caption}${openingName ? ` (${openingName})` : ''}.`}
          shareUrl={inviteUrl(profile?.referralCode, '/')}
          onShared={() => recordShare(true, refreshProfile)}
        />
      </div>
    </div>
  );
}
