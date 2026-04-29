export interface GameRecord {
  id: string;
  platform: string;
  username: string;
  opponent: string;
  pgn: string;
  timeControl: string | null;
  rated: boolean;
  result: string | null;
  playedAt: Date | null;
  createdAt: Date;
  analyzedAt: Date | null;
}

export function gameRecordFromJson(json: any): GameRecord {
  return {
    id: json.id as string,
    platform: json.platform as string,
    username: json.username as string,
    opponent: json.opponent as string,
    pgn: json.pgn as string,
    timeControl: (json.time_control as string | null) ?? null,
    rated: (json.rated as boolean | null) ?? false,
    result: (json.result as string | null) ?? null,
    playedAt: json.played_at ? new Date(json.played_at as string) : null,
    createdAt: new Date(json.created_at as string),
    analyzedAt: json.analyzed_at ? new Date(json.analyzed_at as string) : null,
  };
}
