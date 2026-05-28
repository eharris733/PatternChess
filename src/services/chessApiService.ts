// Port of lib/src/services/chess_api_service.dart — Chess.com archives + Lichess /api/games/user.

export type TimeControlCategory = 'bullet' | 'blitz' | 'rapid' | 'classical';

export interface ImportedGame {
  platform: 'chess.com' | 'lichess';
  username: string;
  opponent: string;
  pgn: string;
  time_control: string | null;
  rated: boolean;
  result: string | null;
  played_at: string | null;
  external_game_id: string;
}

export interface FetchOpts {
  maxGames?: number;
  ratedOnly?: boolean;
  timeControls?: TimeControlCategory[];
  /** When set, only return games strictly newer than this timestamp. */
  since?: Date | null;
}

/** Thrown when a provider keeps returning 429 after our retries are exhausted. */
export class RateLimitError extends Error {
  constructor(public readonly platform: string) {
    super(`${platform} is rate-limiting requests right now. Wait a minute and sync again.`);
    this.name = 'RateLimitError';
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Spacing between chess.com monthly-archive fetches so a big backlog doesn't trip Cloudflare. */
const CHESSCOM_ARCHIVE_SPACING_MS = 300;

function parseRetryAfterMs(res: Response): number | null {
  const h = res.headers.get('Retry-After');
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(h);
  return Number.isNaN(when) ? null : Math.max(0, when - Date.now());
}

/**
 * fetch() with Retry-After-aware backoff. Retries on 429 and 5xx, honoring the
 * Retry-After header (capped at maxDelayMs). Throws RateLimitError when a 429
 * persists after all retries — so a throttled sync fails loudly instead of
 * silently dropping games. Other statuses (incl. 404) return the response so
 * callers handle them as before.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit | undefined,
  platform: string,
  opts: { maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number } = {},
): Promise<Response> {
  const { maxRetries = 3, baseDelayMs = 1000, maxDelayMs = 15000 } = opts;
  let lastRes: Response | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      if (attempt === maxRetries) throw e;
      await sleep(Math.min(baseDelayMs * 2 ** attempt, maxDelayMs));
      continue;
    }
    if (res.status !== 429 && res.status < 500) return res;
    lastRes = res;
    if (attempt === maxRetries) break;
    const retryAfter = parseRetryAfterMs(res);
    await sleep(
      retryAfter !== null
        ? Math.min(retryAfter, maxDelayMs)
        : Math.min(baseDelayMs * 2 ** attempt, maxDelayMs),
    );
  }
  if (lastRes && lastRes.status === 429) throw new RateLimitError(platform);
  return lastRes as Response;
}

export async function fetchChessComGames(
  username: string,
  opts: FetchOpts = {},
): Promise<ImportedGame[]> {
  const { maxGames = 200, ratedOnly = false, timeControls = [], since = null } = opts;
  const sinceMs = since?.getTime() ?? null;
  const sinceMonthKey = since ? archiveKeyFromDate(since) : null;

  const archivesRes = await fetchWithRetry(
    `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`,
    undefined,
    'Chess.com',
  );
  if (!archivesRes.ok) throw new Error(`Failed to fetch chess.com archives for ${username}`);
  const archivesJson = (await archivesRes.json()) as { archives: string[] };
  const archives = [...(archivesJson.archives ?? [])].sort((a, b) => b.localeCompare(a));

  const out: ImportedGame[] = [];
  const cap = since ? Math.max(maxGames, 500) : maxGames;

  let fetchedAnyMonth = false;
  for (const archiveUrl of archives) {
    if (out.length >= cap) break;
    if (sinceMonthKey) {
      const archiveKey = archiveKeyFromUrl(archiveUrl);
      if (archiveKey && archiveKey < sinceMonthKey) break;
    }

    // Space out month fetches so a large backlog doesn't trip Cloudflare.
    if (fetchedAnyMonth) await sleep(CHESSCOM_ARCHIVE_SPACING_MS);
    const monthRes = await fetchWithRetry(archiveUrl, undefined, 'Chess.com');
    fetchedAnyMonth = true;
    // A persistent 429 throws RateLimitError inside fetchWithRetry; a genuine
    // non-OK (e.g. 404) is skipped rather than failing the whole sync.
    if (!monthRes.ok) continue;
    const monthJson = (await monthRes.json()) as { games: any[] };
    const games = [...(monthJson.games ?? [])].sort(
      (a, b) => (b.end_time ?? 0) - (a.end_time ?? 0),
    );

    for (const game of games) {
      if (out.length >= cap) break;
      if (!game.pgn) continue;
      if (ratedOnly && game.rated !== true) continue;
      if (
        timeControls.length > 0 &&
        !timeControls.some((tc) => matchesTimeCategory(game.time_control ?? '', tc))
      ) {
        continue;
      }
      if (sinceMs !== null) {
        const endMs = typeof game.end_time === 'number' ? game.end_time * 1000 : null;
        if (endMs === null || endMs <= sinceMs) continue;
      }

      const white = game.white as { username: string; result: string | null };
      const black = game.black as { username: string; result: string | null };
      const isWhite = white.username.toLowerCase() === username.toLowerCase();

      const externalId = extractChesscomGameId(
        typeof game.url === 'string' ? game.url : null,
        game.pgn as string,
      );
      if (!externalId) {
        console.warn('[sync] chess.com game has no extractable id, skipping', {
          url: game.url,
        });
        continue;
      }

      out.push({
        platform: 'chess.com',
        username,
        opponent: isWhite ? black.username : white.username,
        pgn: game.pgn as string,
        time_control: (game.time_control as string | null) ?? null,
        rated: (game.rated as boolean | null) ?? false,
        result: isWhite ? white.result : black.result,
        played_at:
          typeof game.end_time === 'number'
            ? new Date(game.end_time * 1000).toISOString()
            : null,
        external_game_id: externalId,
      });
    }
  }
  return out;
}

export async function fetchLichessGames(
  username: string,
  opts: FetchOpts = {},
): Promise<ImportedGame[]> {
  const { maxGames = 200, ratedOnly = false, timeControls = [], since = null } = opts;
  const effectiveMax = since ? Math.max(maxGames, 200) : maxGames;
  const params = new URLSearchParams({
    max: String(effectiveMax),
    clocks: 'true',
    evals: 'true',
    opening: 'true',
  });
  if (ratedOnly) params.set('rated', 'true');
  if (timeControls.length > 0) params.set('perfType', timeControls.join(','));
  if (since) params.set('since', String(since.getTime()));

  const res = await fetchWithRetry(
    `https://lichess.org/api/games/user/${encodeURIComponent(username)}?${params.toString()}`,
    { headers: { Accept: 'application/x-chess-pgn' } },
    'Lichess',
  );
  if (!res.ok) throw new Error(`Failed to fetch lichess games for ${username}`);
  const text = await res.text();
  if (text.trim().length === 0) return [];

  const pgns = splitPgnGames(text);
  const out: ImportedGame[] = [];
  for (const pgn of pgns) {
    const headers = extractPgnHeaders(pgn);
    const white = headers.White ?? '';
    const black = headers.Black ?? '';
    const isWhite = white.toLowerCase() === username.toLowerCase();
    const externalId = extractLichessGameId(headers.Site);
    if (!externalId) {
      console.warn('[sync] lichess game has no extractable id, skipping', {
        site: headers.Site,
      });
      continue;
    }
    out.push({
      platform: 'lichess',
      username,
      opponent: isWhite ? black : white,
      pgn,
      time_control: headers.TimeControl ?? null,
      rated: (headers.Event ?? '').includes('Rated'),
      result: headers.Result ?? null,
      played_at:
        headers.UTCDate && headers.UTCTime
          ? parseLichessDateTime(headers.UTCDate, headers.UTCTime)
          : null,
      external_game_id: externalId,
    });
  }
  return out;
}

function extractLichessGameId(site: string | undefined): string | null {
  if (!site) return null;
  const m = /^https?:\/\/lichess\.org\/([A-Za-z0-9]{8})(?:\/|$|[^A-Za-z0-9])/.exec(site);
  return m ? m[1] : null;
}

function extractChesscomGameId(url: string | null, pgn: string): string | null {
  const fromUrl = url ? /\/game\/(?:live|daily)\/(\d+)/.exec(url) : null;
  if (fromUrl) return fromUrl[1];
  const linkMatch = /\[Link "https?:\/\/www\.chess\.com\/game\/(?:live|daily)\/(\d+)"\]/.exec(pgn);
  return linkMatch ? linkMatch[1] : null;
}

function splitPgnGames(text: string): string[] {
  const games: string[] = [];
  const lines = text.split('\n');
  let buffer = '';
  const resultRe = /(1-0|0-1|1\/2-1\/2|\*)\s*$/;
  for (const line of lines) {
    buffer += line + '\n';
    if (!line.startsWith('[') && resultRe.test(line)) {
      const trimmed = buffer.trim();
      if (trimmed) games.push(trimmed);
      buffer = '';
    }
  }
  const trail = buffer.trim();
  if (trail) games.push(trail);
  return games;
}

function extractPgnHeaders(pgn: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /\[(\w+)\s+"([^"]*)"\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pgn)) !== null) out[m[1]] = m[2];
  return out;
}

function parseLichessDateTime(date: string, time: string): string {
  return `${date.replace(/\./g, '-')}T${time}Z`;
}

function archiveKeyFromUrl(url: string): string | null {
  // Chess.com archive URLs end in /YYYY/MM
  const m = /\/(\d{4})\/(\d{2})\/?$/.exec(url);
  if (!m) return null;
  return `${m[1]}-${m[2]}`;
}

function archiveKeyFromDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Base seconds from a raw TC header ("600+5", chess.com "G/1800", etc.). */
function baseSecondsOf(rawTc: string): number | null {
  const basePart = rawTc.split('+')[0].split('/').pop() ?? '';
  const baseSeconds = Number.parseInt(basePart, 10);
  return Number.isNaN(baseSeconds) ? null : baseSeconds;
}

/** Classify a raw time-control header into a category (null if unparseable). */
export function categoryForTimeControl(rawTc: string | null): TimeControlCategory | null {
  if (!rawTc) return null;
  const baseSeconds = baseSecondsOf(rawTc);
  if (baseSeconds === null) return null;
  if (baseSeconds < 180) return 'bullet';
  if (baseSeconds < 600) return 'blitz';
  if (baseSeconds < 1800) return 'rapid';
  return 'classical';
}

function matchesTimeCategory(rawTc: string, category: TimeControlCategory): boolean {
  return categoryForTimeControl(rawTc) === category;
}
