import type { TimeControlCategory } from '../services/chessApiService';
import { BOARD_THEMES, type BoardTheme } from '../state/themeStore';

export interface UserProfile {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  lichessUsername: string | null;
  chesscomUsername: string | null;
  preferredRatedOnly: boolean;
  preferredTimeControls: TimeControlCategory[];
  lastSyncedLichessAt: Date | null;
  lastSyncedChesscomAt: Date | null;
  createdAt: Date;
  currentStreakDays: number;
  longestStreakDays: number;
  lastDrillLocalDate: string | null;
  timezone: string | null;
  boardTheme: BoardTheme;
  /** Show raw engine evals next to win-chance percentages on the training screen. */
  showEngineEvals: boolean;
  /** Show the blunder review step (played move + refutation) before solving. */
  revealBeforeSolve: boolean;
}

function parseBoardTheme(v: unknown): BoardTheme {
  if (typeof v === 'string' && (BOARD_THEMES as readonly string[]).includes(v)) {
    return v as BoardTheme;
  }
  return 'default';
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string' || v.length === 0) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isTimeControl(v: unknown): v is TimeControlCategory {
  return v === 'bullet' || v === 'blitz' || v === 'rapid' || v === 'classical';
}

function parseTimeControls(v: unknown): TimeControlCategory[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<TimeControlCategory>();
  for (const item of v) {
    if (isTimeControl(item)) seen.add(item);
  }
  return Array.from(seen);
}

export function userProfileFromJson(json: any): UserProfile {
  return {
    id: json.id as string,
    displayName: (json.display_name as string | null) ?? null,
    avatarUrl: (json.avatar_url as string | null) ?? null,
    lichessUsername: (json.lichess_username as string | null) ?? null,
    chesscomUsername: (json.chesscom_username as string | null) ?? null,
    preferredRatedOnly: Boolean(json.preferred_rated_only ?? false),
    preferredTimeControls: parseTimeControls(json.preferred_time_controls),
    lastSyncedLichessAt: parseDate(json.last_synced_lichess_at),
    lastSyncedChesscomAt: parseDate(json.last_synced_chesscom_at),
    createdAt: new Date(json.created_at as string),
    currentStreakDays: (json.current_streak_days as number | null) ?? 0,
    longestStreakDays: (json.longest_streak_days as number | null) ?? 0,
    lastDrillLocalDate: (json.last_drill_local_date as string | null) ?? null,
    timezone: (json.timezone as string | null) ?? null,
    boardTheme: parseBoardTheme(json.board_theme),
    // Columns may be absent until the 20260610 migration is applied; default off.
    showEngineEvals: Boolean(json.show_engine_evals ?? false),
    revealBeforeSolve: Boolean(json.reveal_before_solve ?? false),
  };
}

export function userProfileToInsert(p: UserProfile): Record<string, unknown> {
  return {
    id: p.id,
    display_name: p.displayName,
    avatar_url: p.avatarUrl,
    lichess_username: p.lichessUsername,
    chesscom_username: p.chesscomUsername,
    preferred_rated_only: p.preferredRatedOnly,
    preferred_time_controls: p.preferredTimeControls,
    board_theme: p.boardTheme,
  };
}

export function userProfileToUpdate(p: UserProfile): Record<string, unknown> {
  return {
    display_name: p.displayName,
    avatar_url: p.avatarUrl,
    lichess_username: p.lichessUsername,
    chesscom_username: p.chesscomUsername,
    preferred_rated_only: p.preferredRatedOnly,
    preferred_time_controls: p.preferredTimeControls,
    board_theme: p.boardTheme,
  };
}
