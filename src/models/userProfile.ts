export interface UserProfile {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  lichessUsername: string | null;
  chesscomUsername: string | null;
  createdAt: Date;
}

export function userProfileFromJson(json: any): UserProfile {
  return {
    id: json.id as string,
    displayName: (json.display_name as string | null) ?? null,
    avatarUrl: (json.avatar_url as string | null) ?? null,
    lichessUsername: (json.lichess_username as string | null) ?? null,
    chesscomUsername: (json.chesscom_username as string | null) ?? null,
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
  };
}

export function userProfileToUpdate(p: UserProfile): Record<string, unknown> {
  return {
    display_name: p.displayName,
    avatar_url: p.avatarUrl,
    lichess_username: p.lichessUsername,
    chesscom_username: p.chesscomUsername,
  };
}
