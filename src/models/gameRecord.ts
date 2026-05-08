export type GamePhase = 'opening' | 'middlegame' | 'endgame';

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
  eco: string | null;
  openingName: string | null;
  userColor: 'white' | 'black' | null;
  userRating: number | null;
  opponentRating: number | null;
  clockPerPly: number[] | null;
  totalPlies: number | null;
  parsedMetadataAt: Date | null;
}

function parseColor(v: unknown): 'white' | 'black' | null {
  return v === 'white' || v === 'black' ? v : null;
}

function parseClockPerPly(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const out: number[] = [];
  for (const item of v) {
    if (typeof item === 'number' && Number.isFinite(item)) out.push(item);
  }
  return out;
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
    eco: (json.eco as string | null) ?? null,
    openingName: (json.opening_name as string | null) ?? null,
    userColor: parseColor(json.user_color),
    userRating: (json.user_rating as number | null) ?? null,
    opponentRating: (json.opponent_rating as number | null) ?? null,
    clockPerPly: parseClockPerPly(json.clock_per_ply),
    totalPlies: (json.total_plies as number | null) ?? null,
    parsedMetadataAt: json.parsed_metadata_at ? new Date(json.parsed_metadata_at as string) : null,
  };
}

/** ECO family (`B33` → `B3*`) used for opening grouping. */
export function ecoFamily(eco: string | null): string | null {
  if (!eco || eco.length < 2) return null;
  return `${eco[0].toUpperCase()}${eco[1]}*`;
}
