import { supabase } from '../../lib/supabase';
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
  const { data, error } = await supabase
    .from('repertoire_moves')
    .select('id, user_id, color, epd, uci, san, created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;
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
  const { data, error } = await supabase
    .from('repertoire_moves')
    .upsert(
      { user_id: userId, color: input.color, epd: bookEpd(input.fen), uci: input.uci, san: input.san },
      { onConflict: 'user_id,color,epd' },
    )
    .select('id, user_id, color, epd, uci, san, created_at')
    .single();
  if (error) throw error;
  return repertoireMoveFromJson(data);
}

export async function deleteRepertoireMove(id: string): Promise<void> {
  const { error } = await supabase.from('repertoire_moves').delete().eq('id', id);
  if (error) throw error;
}
