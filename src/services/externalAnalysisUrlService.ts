export type ExternalPlatform = 'lichess' | 'chess.com';

export function lichessAnalysisUrl(fen: string): string {
  return `https://lichess.org/analysis/standard/${fen.replace(/ /g, '_')}`;
}

export function chesscomAnalysisUrl(fen: string): string {
  return `https://www.chess.com/analysis?tab=analysis&fen=${encodeURIComponent(fen)}`;
}

export function externalAnalysisUrl(
  platform: ExternalPlatform,
  fen: string,
): { url: string; label: string } {
  if (platform === 'lichess') return { url: lichessAnalysisUrl(fen), label: 'Open on lichess' };
  return { url: chesscomAnalysisUrl(fen), label: 'Open on chess.com' };
}

export function resolvePlatform(
  gamePlatform: string | null | undefined,
  fallback: ExternalPlatform | null,
): ExternalPlatform | null {
  if (gamePlatform === 'lichess') return 'lichess';
  if (gamePlatform === 'chess.com') return 'chess.com';
  return fallback;
}
