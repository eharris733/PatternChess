import { rpc } from '../../lib/api';
import type { Tables } from '../../lib/database.types';
import { bookEpd } from '../../chess/bookFormat';
import type { RepertoireColor, RepertoireMove } from '../../models/repertoire';
import { currentUserId } from './currentUser';

function repertoireMoveFromJson(r: Tables<'repertoire_moves'>): RepertoireMove {
  return {
    id: r.id,
    color: r.color === 'black' ? 'black' : 'white',
    epd: r.epd,
    uci: r.uci,
    san: r.san,
    createdAt: new Date(r.created_at),
  };
}

/** Every repertoire move the user saved (both colours). */
export async function getRepertoire(): Promise<RepertoireMove[]> {
  const data = await rpc<Tables<'repertoire_moves'>[]>('repertoire.list');
  return (data ?? []).map(repertoireMoveFromJson);
}

/** Save (or replace) the user's move for this position. `fen` is the position before the move. */
export async function upsertRepertoireMove(input: {
  color: RepertoireColor;
  fen: string;
  uci: string;
  san: string;
}): Promise<RepertoireMove> {
  const userId = await currentUserId();
  if (!userId) throw new Error('Not signed in');
  const data = await rpc<Tables<'repertoire_moves'>>('repertoire.upsert', {
    color: input.color,
    epd: bookEpd(input.fen),
    uci: input.uci,
    san: input.san,
  });
  return repertoireMoveFromJson(data);
}

export async function deleteRepertoireMove(id: string): Promise<void> {
  await rpc('repertoire.delete', { id });
}
