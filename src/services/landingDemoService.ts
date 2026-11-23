import { extractHeaders } from './pgnParserService';
import { analyzePgn } from './analysisService';
import { getStockfish } from '../hooks/useStockfish';
import type { BlunderCandidate } from '../stockfish/stockfishWorkerClient';
import { classifyMoves, loadOpeningBook, movesFromPgn } from '../chess/openingClassifier';
import { findDeviation, walkFens, type DeviationWalk } from '../chess/openingDeviation';
import { bookEpd } from '../chess/bookFormat';
import { fetchBook } from './openingBookService';
import { buildDemoPlan, type DemoColor, type DemoPlan } from './demoPlan';
import { currentT } from '../i18n/useT';

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
  /** "Your plan for today" preview: openings + endgames from the same games. */
  plan: DemoPlan;
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
/** The opening part of the plan is a nice-to-have: never hold the demo up for it. */
const OPENING_PREP_TIMEOUT_MS = 8000;

interface OpeningPrep {
  family: string | null;
  color: DemoColor | null;
  walk: DeviationWalk | null;
}

function demoColor(headers: Record<string, string>, username: string): DemoColor | null {
  const lower = username.toLowerCase();
  if (headers.White?.toLowerCase() === lower) return 'white';
  if (headers.Black?.toLowerCase() === lower) return 'black';
  return null;
}

/**
 * Each game's opening family (from the board) and its walk through the
 * opening book, in one batched /api/book request. Network only, no engine.
 * A failed book request leaves every walk null; the plan then shows the
 * opening share without the theory exit.
 */
async function prepareOpenings(
  games: { pgn: string; headers: Record<string, string> }[],
  username: string,
): Promise<OpeningPrep[]> {
  const book = await loadOpeningBook().catch(() => null);
  const parsed = games.map((g) => {
    const moves = movesFromPgn(g.pgn);
    return {
      moves,
      color: demoColor(g.headers, username),
      family: book && moves ? (classifyMoves(book, moves)?.family ?? null) : null,
    };
  });
  const fens = parsed.flatMap((p) => (p.moves && p.color ? walkFens(p.moves) : []));
  const positions = fens.length > 0 ? await fetchBook(fens) : null;
  return Promise.all(
    parsed.map(async (p) => {
      if (!positions || !p.moves || !p.color) return { family: p.family, color: p.color, walk: null };
      const walk = await findDeviation(p.moves, p.color, async (fen) => positions.get(bookEpd(fen)) ?? null);
      return { family: p.family, color: p.color, walk: walk === 'retry' ? null : walk };
    }),
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

export async function runDemoAnalysis(opts: RunOpts): Promise<DemoResult> {
  const { platform, username, onProgress, signal } = opts;
  const ensureLive = () => {
    if (signal.aborted) throw new DemoError('aborted', 'Run aborted');
  };

  // Progress and error copy follow the visitor's language at run time.
  const t = currentT();
  const platformName = platform === 'lichess' ? 'Lichess' : 'Chess.com';
  onProgress(t('demo.progress.fetching', { platform: platformName }));
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
      e instanceof Error ? e.message : t('demo.err.network'),
    );
  }
  ensureLive();

  if (pgns.length === 0) {
    throw new DemoError(
      'not-found',
      t('demo.err.noGames', { username, platform: platformName }),
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
      t('demo.err.tooShort'),
    );
  }

  // Book walk runs while the engine analyzes.
  const openingPrep = prepareOpenings(gamesWithHeaders, username).catch(() => null);

  onProgress(t('demo.progress.engine'));
  let sf;
  try {
    sf = await getStockfish();
  } catch (e) {
    throw new DemoError(
      'engine-failed',
      e instanceof Error ? e.message : t('demo.err.engine'),
    );
  }
  ensureLive();

  const allBlunders: BlunderCandidate[] = [];
  const blundersByGame: BlunderCandidate[][] = [];
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
          onProgress(
            gamesWithHeaders.length > 1
              ? t('demo.progress.analyzingGame', {
                  at: current + 1,
                  total,
                  game: gi + 1,
                  games: gamesWithHeaders.length,
                })
              : t('demo.progress.analyzing', { at: current + 1, total }),
          );
        }
      },
    });
    positionsAnalyzed += positions.length;
    allBlunders.push(...blunders);
    blundersByGame.push(blunders);
  }

  ensureLive();

  onProgress(t('demo.progress.building'));
  const prep = await withTimeout(openingPrep, OPENING_PREP_TIMEOUT_MS, null);
  ensureLive();
  const plan = buildDemoPlan(
    gamesWithHeaders.map((g, i) => ({
      family: prep?.[i]?.family ?? null,
      color: prep?.[i]?.color ?? demoColor(g.headers, username),
      result: g.headers.Result ?? null,
      blunders: blundersByGame[i] ?? [],
      walk: prep?.[i]?.walk ?? null,
    })),
  );

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
    plan,
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
      currentT()('demo.err.lichessNoUser', { username }),
    );
  }
  if (res.status === 429) {
    throw new DemoError(
      'rate-limited',
      currentT()('demo.err.lichessRate'),
    );
  }
  if (!res.ok) {
    throw new DemoError('network', currentT()('demo.err.status', { platform: 'Lichess', status: res.status }));
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
      currentT()('demo.err.chesscomNoUser', { username }),
    );
  }
  if (archivesRes.status === 429) {
    throw new DemoError(
      'rate-limited',
      currentT()('demo.err.chesscomRate'),
    );
  }
  if (!archivesRes.ok) {
    throw new DemoError('network', currentT()('demo.err.status', { platform: 'Chess.com', status: archivesRes.status }));
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
