import { rpc } from '../../lib/api';
import type { Tables } from '../../lib/database.types';
import {
  GameAnnotation,
  gameAnnotationFromJson,
  MoveAnnotation,
  moveAnnotationToJson,
} from '../../models/gameAnnotation';

// Server side: functions/_shared/rpc/training.ts (`annotations.*`), scoped to
// the session user's own games.

export async function getAnnotations(gameId: string): Promise<GameAnnotation | null> {
  const row = await rpc<Tables<'game_annotations'> | null>('annotations.get', { gameId });
  return row ? gameAnnotationFromJson(row) : null;
}

export async function saveAnnotations(
  gameId: string,
  annotations: MoveAnnotation[],
): Promise<void> {
  // Upsert on game_id; the server sets user_id and updated_at.
  await rpc('annotations.save', { gameId, annotations: annotations.map(moveAnnotationToJson) });
}
