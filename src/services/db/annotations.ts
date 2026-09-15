import { supabase, toJson } from '../../lib/supabase';
import {
  GameAnnotation,
  gameAnnotationFromJson,
  MoveAnnotation,
  moveAnnotationToJson,
} from '../../models/gameAnnotation';
import { currentUserId } from './currentUser';

export async function getAnnotations(gameId: string): Promise<GameAnnotation | null> {
  const { data, error } = await supabase
    .from('game_annotations')
    .select()
    .eq('game_id', gameId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return gameAnnotationFromJson(data);
}

export async function saveAnnotations(
  gameId: string,
  annotations: MoveAnnotation[],
): Promise<void> {
  const userId = await currentUserId();
  const payload = {
    game_id: gameId,
    user_id: userId,
    annotations: toJson(annotations.map(moveAnnotationToJson)),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('game_annotations')
    .upsert(payload, { onConflict: 'game_id' });
  if (error) throw error;
}
