import type { TimeControlCategory } from '../services/chessApiService';

export interface UserProfile {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  lichessUsername: string | null;
  chesscomUsername: string | null;
  preferredRatedOnly: boolean;
  preferredTimeControl: TimeControlCategory | null;
  lastSyncedLichessAt: Date | null;
  lastSyncedChesscomAt: Date | null;
  createdAt: Date;
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string' || v.length === 0) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseTimeControl(v: unknown): TimeControlCategory | null {
  if (v === 'bullet' || v === 'blitz' || v === 'rapid' || v === 'classical') return v;
  return null;
}

export function userProfileFromJson(json: any): UserProfile {
  return {
    id: json.id as string,
    displayName: (json.display_name as string | null) ?? null,
    avatarUrl: (json.avatar_url as string | null) ?? null,
    lichessUsername: (json.lichess_username as string | null) ?? null,
    chesscomUsername: (json.chesscom_username as string | null) ?? null,
    preferredRatedOnly: Boolean(json.preferred_rated_only ?? false),
    preferredTimeControl: parseTimeControl(json.preferred_time_control),
    lastSyncedLichessAt: parseDate(json.last_synced_lichess_at),
    lastSyncedChesscomAt: parseDate(json.last_synced_chesscom_at),
    createdAt: new Date(json.created_at as string),
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
    preferred_time_control: p.preferredTimeControl,
  };
}

export function userProfileToUpdate(p: UserProfile): Record<string, unknown> {
  return {
    display_name: p.displayName,
    avatar_url: p.avatarUrl,
    lichess_username: p.lichessUsername,
    chesscom_username: p.chesscomUsername,
    preferred_rated_only: p.preferredRatedOnly,
    preferred_time_control: p.preferredTimeControl,
  };
}
