export type MoveGrade = 'A' | 'S' | 'D' | 'F';

export const MOVE_GRADES: MoveGrade[] = ['A', 'S', 'D', 'F'];

export const MOVE_GRADE_LABEL: Record<MoveGrade, string> = {
  A: 'Good',
  S: 'Inaccuracy',
  D: 'Mistake',
  F: 'Blunder',
};

export const MOVE_GRADE_COLOR: Record<MoveGrade, string> = {
  A: '#4CAF50',
  S: '#42A5F5',
  D: '#FFC107',
  F: '#F44336',
};

export const MOVE_GRADE_TW_BG: Record<MoveGrade, string> = {
  A: 'bg-correct/20 text-correct border-correct/30',
  S: 'bg-inaccuracy/20 text-inaccuracy border-inaccuracy/30',
  D: 'bg-mistake/20 text-mistake border-mistake/30',
  F: 'bg-incorrect/20 text-incorrect border-incorrect/30',
};

export function gradeFromString(value: string | null | undefined): MoveGrade | null {
  if (!value) return null;
  return (MOVE_GRADES as readonly string[]).includes(value) ? (value as MoveGrade) : null;
}

export interface MoveAnnotation {
  moveNumber: number;
  side: 'white' | 'black' | string;
  san: string;
  classification: MoveGrade | null;
  text: string | null;
}

export function annotationKey(moveNumber: number, side: string): string {
  return `${moveNumber}_${side}`;
}

export function moveAnnotationFromJson(json: any): MoveAnnotation {
  return {
    moveNumber: json.moveNumber as number,
    side: json.side as string,
    san: json.san as string,
    classification: gradeFromString(json.classification as string | null),
    text: (json.text as string | null) ?? null,
  };
}

export function moveAnnotationToJson(a: MoveAnnotation): Record<string, unknown> {
  return {
    moveNumber: a.moveNumber,
    side: a.side,
    san: a.san,
    classification: a.classification,
    text: a.text,
  };
}

export interface GameAnnotation {
  id: string | null;
  gameId: string;
  annotations: MoveAnnotation[];
  createdAt: Date | null;
  updatedAt: Date | null;
}

export function gameAnnotationFromJson(json: any): GameAnnotation {
  return {
    id: (json.id as string | null) ?? null,
    gameId: json.game_id as string,
    annotations: ((json.annotations as any[]) ?? []).map(moveAnnotationFromJson),
    createdAt: json.created_at ? new Date(json.created_at as string) : null,
    updatedAt: json.updated_at ? new Date(json.updated_at as string) : null,
  };
}
