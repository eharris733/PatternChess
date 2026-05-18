import { extractHeaders } from './pgnParserService';
import { analyzePgn } from './analysisService';
import { getStockfish } from '../hooks/useStockfish';
import type { BlunderCandidate } from '../stockfish/stockfishWorkerClient';

export type DemoPlatform = 'lichess' | 'chesscom';

export interface DemoResult {
  platform: DemoPlatform;
  username: string;
  gamesAnalyzed: number;
  positionsAnalyzed: number;
  blundersFound: number;
  biggestSwing: number | null;
  eco: string | null;
  openingName: string | null;
  blunder: BlunderCandidate | null;
}

export type DemoErrorCode =
  | 'not-found'
  | 'rate-limited'
  | 'too-short'
  | 'engine-failed'
  | 'network'
  | 'aborted';

export class DemoError extends Error {
  code: DemoErrorCode;
  constructor(code: DemoErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

interface RunOpts {
  platform: DemoPlatform;
  username: string;
  onProgress: (label: string) => void;
  signal: AbortSignal;
}

const MAX_PLIES = 120;
const MAX_GAMES = 5;

export async function runDemoAnalysis(opts: RunOpts): Promise<DemoResult> {
  const { platform, username, onProgress, signal } = opts;
  const ensureLive = () => {
    if (signal.aborted) throw new DemoError('aborted', 'Run aborted');
  };

  onProgress(`Fetching ${platform === 'lichess' ? 'Lichess' : 'Chess.com'} games…`);
  let pgns: string[];
  try {
    pgns =
      platform === 'lichess'
        ? await fetchLichessPgns(username, MAX_GAMES, signal)
        : await fetchChessComPgns(username, MAX_GAMES, signal);
  } catch (e) {
    if (e instanceof DemoError) throw e;
    if (signal.aborted) throw new DemoError('aborted', 'Run aborted');
    throw new DemoError(
      'network',
      e instanceof Error ? e.message : 'Network request failed',
    );
  }
  ensureLive();

  if (pgns.length === 0) {
    throw new DemoError(
      'not-found',
      `We couldn't find any recent games for "${username}" on ${platform === 'lichess' ? 'Lichess' : 'Chess.com'}. Check the spelling or try the other platform.`,
    );
  }

  const gamesWithHeaders = pgns
    .map((pgn) => ({ pgn, headers: extractHeaders(pgn) }))
    // Filter degenerate PGNs (no moves or abort/forfeit) the same way the old
    // 5-ply guard did, before we hand them to the engine.
    .filter((g) => /\b\d+\.\s*\S/.test(g.pgn));

  if (gamesWithHeaders.length === 0) {
    throw new DemoError(
      'too-short',
      'Those games were too short to analyze. Try a username with longer games.',
    );
  }

  onProgress('Loading engine…');
  let sf;
  try {
    sf = await getStockfish();
  } catch (e) {
    throw new DemoError(
      'engine-failed',
      e instanceof Error ? e.message : 'Engine failed to start.',
    );
  }
  ensureLive();

  const allBlunders: BlunderCandidate[] = [];
  let positionsAnalyzed = 0;
  let openingName: string | null = null;
  let eco: string | null = null;

  for (let gi = 0; gi < gamesWithHeaders.length; gi++) {
    ensureLive();
    const game = gamesWithHeaders[gi];

    if (!openingName) {
      openingName =
        game.headers.Opening?.trim() ||
        game.headers.Variation?.trim() ||
        null;
    }
    if (!eco) {
      eco = game.headers.ECO?.trim() || null;
    }

    const { blunders, positions } = await analyzePgn(sf, game.pgn, username, {
      maxPlies: MAX_PLIES,
      onProgress: (current, total) => {
        if (signal.aborted) return;
        if (current % 3 === 0 || current === total - 1) {
          const gameNum =
            gamesWithHeaders.length > 1
              ? ` (game ${gi + 1}/${gamesWithHeaders.length})`
              : '';
          onProgress(`Analyzing position ${current + 1}/${total}${gameNum}…`);
        }
      },
    });
    positionsAnalyzed += positions.length;
    allBlunders.push(...blunders);
  }

  ensureLive();

  allBlunders.sort((a, b) => b.evalSwing - a.evalSwing);
  const top = allBlunders[0] ?? null;

  return {
    platform,
    username,
    gamesAnalyzed: gamesWithHeaders.length,
    positionsAnalyzed,
    blundersFound: allBlunders.length,
    biggestSwing: top ? top.evalSwing : null,
    eco,
    openingName,
    blunder: top,
  };
}

async function fetchLichessPgns(
  username: string,
  max: number,
  signal: AbortSignal,
): Promise<string[]> {
  const params = new URLSearchParams({
    max: String(max),
    clocks: 'false',
    evals: 'false',
    opening: 'true',
  });
  const res = await fetch(
    `https://lichess.org/api/games/user/${encodeURIComponent(username)}?${params.toString()}`,
    { headers: { Accept: 'application/x-chess-pgn' }, signal },
  );
  if (res.status === 404) {
    throw new DemoError(
      'not-found',
      `Lichess doesn't have a user called "${username}". Check the spelling or try Chess.com.`,
    );
  }
  if (res.status === 429) {
    throw new DemoError(
      'rate-limited',
      'Lichess is rate-limiting us right now. Try again in a minute, or sign up to import your full history.',
    );
  }
  if (!res.ok) {
    throw new DemoError('network', `Lichess returned ${res.status}.`);
  }
  const text = await res.text();
  if (text.trim().length === 0) return [];
  return splitPgnStream(text);
}

async function fetchChessComPgns(
  username: string,
  max: number,
  signal: AbortSignal,
): Promise<string[]> {
  const archivesRes = await fetch(
    `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`,
    { signal },
  );
  if (archivesRes.status === 404) {
    throw new DemoError(
      'not-found',
      `Chess.com doesn't have a user called "${username}". Check the spelling or try Lichess.`,
    );
  }
  if (archivesRes.status === 429) {
    throw new DemoError(
      'rate-limited',
      'Chess.com is rate-limiting us right now. Try again in a minute.',
    );
  }
  if (!archivesRes.ok) {
    throw new DemoError('network', `Chess.com returned ${archivesRes.status}.`);
  }
  const archivesJson = (await archivesRes.json()) as { archives?: string[] };
  const archives = [...(archivesJson.archives ?? [])].sort((a, b) => b.localeCompare(a));
  if (archives.length === 0) return [];

  const out: string[] = [];
  for (const archiveUrl of archives) {
    if (out.length >= max) break;
    const monthRes = await fetch(archiveUrl, { signal });
    if (!monthRes.ok) continue;
    const monthJson = (await monthRes.json()) as { games?: { pgn?: string; end_time?: number }[] };
    const games = [...(monthJson.games ?? [])].sort(
      (a, b) => (b.end_time ?? 0) - (a.end_time ?? 0),
    );
    for (const game of games) {
      if (out.length >= max) break;
      if (game.pgn) out.push(game.pgn);
    }
  }
  return out;
}

function splitPgnStream(text: string): string[] {
  const lines = text.split('\n');
  const games: string[] = [];
  let buf: string[] = [];
  let inMoves = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('[') && inMoves && buf.length > 0) {
      games.push(buf.join('\n').trim());
      buf = [];
      inMoves = false;
    }
    if (line.length === 0) {
      if (buf.length > 0 && buf.some((l) => l.startsWith('['))) inMoves = true;
    }
    buf.push(line);
  }
  if (buf.length > 0 && buf.some((l) => l.trim().length > 0)) {
    games.push(buf.join('\n').trim());
  }
  return games.filter((g) => g.length > 0);
}
