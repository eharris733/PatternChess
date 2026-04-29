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
}

export interface FetchOpts {
  maxGames?: number;
  ratedOnly?: boolean;
  timeControl?: TimeControlCategory | null;
}

export async function fetchChessComGames(
  username: string,
  opts: FetchOpts = {},
): Promise<ImportedGame[]> {
  const { maxGames = 25, ratedOnly = false, timeControl = null } = opts;

  const archivesRes = await fetch(
    `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`,
  );
  if (!archivesRes.ok) throw new Error(`Failed to fetch chess.com archives for ${username}`);
  const archivesJson = (await archivesRes.json()) as { archives: string[] };
  const archives = [...(archivesJson.archives ?? [])].sort((a, b) => b.localeCompare(a));

  const out: ImportedGame[] = [];

  for (const archiveUrl of archives) {
    if (out.length >= maxGames) break;

    const monthRes = await fetch(archiveUrl);
    if (!monthRes.ok) continue;
    const monthJson = (await monthRes.json()) as { games: any[] };
    const games = [...(monthJson.games ?? [])].sort(
      (a, b) => (b.end_time ?? 0) - (a.end_time ?? 0),
    );

    for (const game of games) {
      if (out.length >= maxGames) break;
      if (!game.pgn) continue;
      if (ratedOnly && game.rated !== true) continue;
      if (timeControl && !matchesTimeCategory(game.time_control ?? '', timeControl)) continue;

      const white = game.white as { username: string; result: string | null };
      const black = game.black as { username: string; result: string | null };
      const isWhite = white.username.toLowerCase() === username.toLowerCase();

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
      });
    }
  }
  return out;
}

export async function fetchLichessGames(
  username: string,
  opts: FetchOpts & { perfType?: TimeControlCategory | null } = {},
): Promise<ImportedGame[]> {
  const { maxGames = 25, ratedOnly = false, perfType = null } = opts;
  const params = new URLSearchParams({
    max: String(maxGames),
    clocks: 'true',
    evals: 'true',
    opening: 'true',
  });
  if (ratedOnly) params.set('rated', 'true');
  if (perfType) params.set('perfType', perfType);

  const res = await fetch(
    `https://lichess.org/api/games/user/${encodeURIComponent(username)}?${params.toString()}`,
    { headers: { Accept: 'application/x-chess-pgn' } },
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
    });
  }
  return out;
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

function matchesTimeCategory(rawTc: string, category: TimeControlCategory): boolean {
  const basePart = rawTc.split('+')[0].split('/').pop() ?? '';
  const baseSeconds = Number.parseInt(basePart, 10);
  if (Number.isNaN(baseSeconds)) return false;
  switch (category) {
    case 'bullet':
      return baseSeconds < 180;
    case 'blitz':
      return baseSeconds >= 180 && baseSeconds < 600;
    case 'rapid':
      return baseSeconds >= 600 && baseSeconds < 1800;
    case 'classical':
      return baseSeconds >= 1800;
  }
}
