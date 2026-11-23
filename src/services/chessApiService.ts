// Port of lib/src/services/chess_api_service.dart — Chess.com archives + Lichess /api/games/user.

export type TimeControlCategory = 'bullet' | 'blitz' | 'rapid' | 'classical';

/** Every trainable time-control category, in display order. New users default to all. */
export const ALL_TIME_CONTROLS: TimeControlCategory[] = ['bullet', 'blitz', 'rapid', 'classical'];

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
  /**
   * The side the synced account played, stored at insert so the openings
   * walk (which runs during sync analysis) knows it before analysis writes
   * the game's metadata. Null when neither player name matches.
   */
  user_color: 'white' | 'black' | null;
}

/** Which side `username` played, by the players' names (case-insensitive). */
export function sideOf(username: string, white: string, black: string): 'white' | 'black' | null {
  const u = username.toLowerCase();
  if (white.toLowerCase() === u) return 'white';
  if (black.toLowerCase() === u) return 'black';
  return null;
}

export interface FetchOpts {
  maxGames?: number;
  ratedOnly?: boolean;
  timeControls?: TimeControlCategory[];
  /** When set, only return games strictly newer than this timestamp. */
  since?: Date | null;
  /** Live fetch progress: called as games arrive (Lichess stream, chess.com month bodies). */
  onProgress?: (p: FetchProgress) => void;
}

export interface FetchProgress {
  /** Games kept so far (after the rated / time-control filters). */
  fetched: number;
  /** The most this fetch returns (the game cap), or null when it is open-ended (incremental sync). */
  target: number | null;
  /** chess.com only: monthly archives read so far. */
  monthsDone?: number;
  /**
   * chess.com only: archives in the window, when that bounds the fetch
   * (incremental sync). Null on a backlog import, which stops at `target`
   * games long before it runs out of months.
   */
  monthsTotal?: number | null;
}

/** Minimum gap between streamed Lichess progress callbacks. */
const LICHESS_PROGRESS_MS = 200;

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
export async function fetchWithRetry(
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
  const { maxGames = 200, ratedOnly = false, timeControls = [], since = null, onProgress } = opts;
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
  // The months this fetch may read: newest first, back to the `since` month.
  const window = sinceMonthKey
    ? archives.filter((url) => {
        const key = archiveKeyFromUrl(url);
        return !key || key >= sinceMonthKey;
      })
    : archives;
  const target = since ? null : cap;
  const monthsTotal = since ? window.length : null;
  let monthsDone = 0;
  let lastKey = '';
  const emit = (fetched: number) => {
    const key = `${fetched}|${monthsDone}`;
    if (key === lastKey) return;
    lastKey = key;
    onProgress?.({ fetched, target, monthsDone, monthsTotal });
  };
  const report = () => emit(out.length);
  report();

  // The same filters the month loop applies, so the live count while a
  // month downloads only counts games this fetch will keep.
  const keepable = (game: any): boolean => {
    if (!game?.pgn) return false;
    if (ratedOnly && game.rated !== true) return false;
    if (
      timeControls.length > 0 &&
      !timeControls.some((tc) => matchesTimeCategory(game.time_control ?? '', tc))
    ) {
      return false;
    }
    if (sinceMs !== null) {
      const endMs = typeof game.end_time === 'number' ? game.end_time * 1000 : null;
      if (endMs === null || endMs <= sinceMs) return false;
    }
    return true;
  };

  let fetchedAnyMonth = false;
  for (const archiveUrl of window) {
    if (out.length >= cap) break;

    // Space out month fetches so a large backlog doesn't trip Cloudflare.
    if (fetchedAnyMonth) await sleep(CHESSCOM_ARCHIVE_SPACING_MS);
    const monthRes = await fetchWithRetry(archiveUrl, undefined, 'Chess.com');
    fetchedAnyMonth = true;
    monthsDone++;
    // A persistent 429 throws RateLimitError inside fetchWithRetry; a genuine
    // non-OK (e.g. 404) is skipped rather than failing the whole sync.
    if (!monthRes.ok) {
      report();
      continue;
    }
    // One month can hold hundreds of games (several MB): count them as the
    // body streams so the pill moves during a big month, not only after it.
    const base = out.length;
    const room = cap - base;
    const monthText = await readChessComMonthWithProgress(monthRes, keepable, (kept) =>
      emit(base + Math.min(room, kept)),
    );
    const monthJson = JSON.parse(monthText) as { games: any[] };
    const games = [...(monthJson.games ?? [])].sort(
      (a, b) => (b.end_time ?? 0) - (a.end_time ?? 0),
    );

    for (const game of games) {
      if (out.length >= cap) break;
      if (!keepable(game)) continue;

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
        user_color: sideOf(username, white.username, black.username),
      });
    }
    report();
  }
  return out;
}

export async function fetchLichessGames(
  username: string,
  opts: FetchOpts = {},
): Promise<ImportedGame[]> {
  const { maxGames = 200, ratedOnly = false, timeControls = [], since = null, onProgress } = opts;
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
  const target = since ? null : effectiveMax;
  onProgress?.({ fetched: 0, target });
  const text = await readStreamWithProgress(res, (games) => onProgress?.({ fetched: games, target }));
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
      rated: isLichessRated(headers),
      result: headers.Result ?? null,
      played_at:
        headers.UTCDate && headers.UTCTime
          ? parseLichessDateTime(headers.UTCDate, headers.UTCTime)
          : null,
      external_game_id: externalId,
      user_color: sideOf(username, white, black),
    });
  }
  // Every game unreadable means the export format moved under us (it did on
  // 2026-10-22). Fail loudly: returning [] would show "Up to date".
  if (pgns.length > 0 && out.length === 0) {
    throw new Error(`Couldn't read any of the ${pgns.length} games Lichess returned`);
  }
  onProgress?.({ fetched: out.length, target });
  return out;
}

/**
 * Read a streamed PGN export, reporting how many games have fully arrived
 * (Lichess streams the export at a few dozen games a second, so a 200-game
 * import takes long enough to want a live count). A game is complete once
 * the next one's `[Event` header starts. Falls back to `text()` when the
 * body can't be streamed.
 */
export async function readStreamWithProgress(
  res: Response,
  onGames: (completeGames: number) => void,
): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return res.text();
  const decoder = new TextDecoder();
  let text = '';
  let starts = 0;
  let scanFrom = 0;
  let lastReported = -1;
  let lastAt = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    // Count new game starts since the last chunk. Resume 7 characters back
    // (one short of the 8-character marker) so a header split across chunks
    // is seen exactly once.
    const re = /(?:^|\n)\[Event /g;
    re.lastIndex = scanFrom;
    let matchEnd = 0;
    while (re.exec(text) !== null) {
      starts++;
      matchEnd = re.lastIndex;
    }
    scanFrom = Math.max(matchEnd, text.length - 7, 0);
    const complete = Math.max(0, starts - 1);
    const now = Date.now();
    if (complete !== lastReported && now - lastAt >= LICHESS_PROGRESS_MS) {
      lastReported = complete;
      lastAt = now;
      onGames(complete);
    }
  }
  text += decoder.decode();
  return text;
}

/**
 * Reads a chess.com monthly archive (`{"games":[{...},{...}]}`) as it streams
 * and calls `onKept` with how many complete games so far pass `keep`
 * (throttled like the Lichess stream). Each game object is cut out by a
 * string-aware brace scan and parsed on its own; the caller still parses the
 * returned text as a whole, so a malformed or unexpected body only loses the
 * live count, never games.
 */
export async function readChessComMonthWithProgress(
  res: Response,
  keep: (game: unknown) => boolean,
  onKept: (kept: number) => void,
): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return res.text();
  const decoder = new TextDecoder();
  let text = '';
  let pos = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let itemStart = -1;
  let kept = 0;
  // The caller has already shown the count before this month.
  let lastReported = 0;
  let lastAt = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    for (; pos < text.length; pos++) {
      const ch = text.charCodeAt(pos);
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === 92 /* backslash */) escaped = true;
        else if (ch === 34 /* " */) inString = false;
        continue;
      }
      if (ch === 34) {
        inString = true;
      } else if (ch === 123 /* { */ || ch === 91 /* [ */) {
        depth++;
        // {"games":[ puts each game object at depth 3.
        if (ch === 123 && depth === 3) itemStart = pos;
      } else if (ch === 125 /* } */ || ch === 93 /* ] */) {
        if (ch === 125 && depth === 3 && itemStart >= 0) {
          try {
            if (keep(JSON.parse(text.slice(itemStart, pos + 1)))) kept++;
          } catch {
            // Not a game object after all; the whole-body parse decides.
          }
          itemStart = -1;
        }
        depth--;
      }
    }
    const now = Date.now();
    if (kept !== lastReported && now - lastAt >= LICHESS_PROGRESS_MS) {
      lastReported = kept;
      lastAt = now;
      onKept(kept);
    }
  }
  text += decoder.decode();
  return text;
}

/**
 * Lichess PGN has no `Rated` header. Its Event reads "rated blitz game" /
 * "casual blitz game" (lowercase) for ordinary games, but arena games carry the
 * tournament name instead, so a `*RatingDiff` header (written only for rated
 * games) is the fallback signal.
 */
export function isLichessRated(headers: Record<string, string>): boolean {
  if (/^rated\b/i.test(headers.Event ?? '')) return true;
  return headers.WhiteRatingDiff !== undefined || headers.BlackRatingDiff !== undefined;
}

/**
 * Resolve a Lichess study id from a full study/chapter URL or a bare id.
 * Study and chapter ids are 8 alphanumeric chars; chapter URLs append a second
 * one (`/study/{studyId}/{chapterId}`) — we always take the study id (the first).
 * Returns null when the input isn't recognizable as a study reference.
 */
export function parseLichessStudyId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9]{8}$/.test(trimmed)) return trimmed;
  const m = /lichess\.org\/study\/([A-Za-z0-9]{8})/.exec(trimmed);
  return m ? m[1] : null;
}

/**
 * Fetch a public Lichess study as a single multi-game PGN (one game per chapter).
 * No auth — only public studies are exportable this way. Throws friendly errors
 * for an unparseable URL or a private/missing study so callers can surface them.
 */
export async function fetchLichessStudyPgn(input: string): Promise<string> {
  const id = parseLichessStudyId(input);
  if (!id) {
    throw new Error("That doesn't look like a Lichess study URL.");
  }
  const res = await fetchWithRetry(
    `https://lichess.org/api/study/${id}.pgn?clocks=true&comments=true`,
    { headers: { Accept: 'application/x-chess-pgn' } },
    'Lichess',
  );
  if (res.status === 404) {
    throw new Error("Study not found, or it's private (only public studies can be imported).");
  }
  if (!res.ok) throw new Error(`Failed to fetch Lichess study ${id}.`);
  return res.text();
}

/**
 * Lichess moved game pages to `lichess.org/game/<id>` on 2026-10-22; older
 * exports (and PGN files people saved) still say `lichess.org/<id>`. Accept
 * both — rejecting the new form silently skipped every synced game.
 */
export function extractLichessGameId(site: string | undefined): string | null {
  if (!site) return null;
  const m = /^https?:\/\/lichess\.org\/(?:game\/)?([A-Za-z0-9]{8})(?:\/|$|[^A-Za-z0-9])/.exec(site);
  return m ? m[1] : null;
}

export function extractChesscomGameId(url: string | null, pgn: string): string | null {
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
