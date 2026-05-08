export interface TrainingSession {
  id: string;
  userId: string;
  startedAt: Date;
  endedAt: Date | null;
  localDate: string;
  blundersAttempted: number;
  blundersCorrect: number;
  cyclesCompleted: number;
}

export function trainingSessionFromJson(json: any): TrainingSession {
  return {
    id: json.id as string,
    userId: json.user_id as string,
    startedAt: new Date(json.started_at as string),
    endedAt: json.ended_at ? new Date(json.ended_at as string) : null,
    localDate: json.local_date as string,
    blundersAttempted: (json.blunders_attempted as number | null) ?? 0,
    blundersCorrect: (json.blunders_correct as number | null) ?? 0,
    cyclesCompleted: (json.cycles_completed as number | null) ?? 0,
  };
}
