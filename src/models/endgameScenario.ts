export type DeservedResult = 'win' | 'draw';
export type ScenarioStatus = 'pending' | 'passed' | 'failed';

/**
 * An endgame the user dropped points in: they held a winning (or holdable)
 * position in the endgame phase and the game ended worse. The play-out starts
 * from just before the first point-dropping mistake.
 */
export interface EndgameScenario {
  id: string;
  gameId: string;
  /** First point-dropping endgame blunder; null if the row was since deleted. */
  blunderId: string | null;
  startFen: string;
  userColor: 'white' | 'black';
  deservedResult: DeservedResult;
  actualResult: 'loss' | 'draw';
  status: ScenarioStatus;
  attempts: number;
  lastPlayedAt: Date | null;
  createdAt: Date;
}

export function endgameScenarioFromJson(json: any): EndgameScenario {
  return {
    id: json.id as string,
    gameId: json.game_id as string,
    blunderId: (json.blunder_id as string | null) ?? null,
    startFen: json.start_fen as string,
    userColor: json.user_color === 'black' ? 'black' : 'white',
    deservedResult: json.deserved_result === 'draw' ? 'draw' : 'win',
    actualResult: json.actual_result === 'draw' ? 'draw' : 'loss',
    status:
      json.status === 'passed' ? 'passed' : json.status === 'failed' ? 'failed' : 'pending',
    attempts: (json.attempts as number | null) ?? 0,
    lastPlayedAt: json.last_played_at ? new Date(json.last_played_at as string) : null,
    createdAt: new Date(json.created_at as string),
  };
}
