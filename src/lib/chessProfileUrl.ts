export function lichessProfileUrl(username: string): string {
  return `https://lichess.org/@/${encodeURIComponent(username)}`;
}

export function chesscomProfileUrl(username: string): string {
  return `https://www.chess.com/member/${encodeURIComponent(username)}`;
}

export function chessProfileLink(
  platform: 'lichess' | 'chesscom' | string | null,
  username: string,
): { href: string; label: string } | null {
  if (!username) return null;
  if (platform === 'lichess') {
    return { href: lichessProfileUrl(username), label: `lichess.org/@/${username}` };
  }
  if (platform === 'chesscom') {
    return { href: chesscomProfileUrl(username), label: `chess.com/member/${username}` };
  }
  return null;
}
