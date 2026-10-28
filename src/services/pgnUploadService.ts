import { analyzeGames } from './analysisService';
import { extractChesscomGameId, extractLichessGameId, isLichessRated } from './chessApiService';
import { extractHeaders, parsePgnMetadata } from './pgnParserService';
import { classifyGameRowsForInsert } from './openingClassificationService';
import { supabaseService } from './supabaseService';
import type { TablesInsert } from '../lib/database.types';

type GameInsert = Omit<TablesInsert<'games'>, 'user_id'>;

export interface PgnUploadProgress {
  phase: 'parsing' | 'inserting' | 'analyzing' | 'done';
  current: number;
  total: number;
  blundersFound: number;
}

export interface PgnUploadResult {
  totalGames: number;
  inserted: number;
  duplicates: number;
  blundersFound: number;
  /** Games whose White/Black headers didn't match the entered name. */
  unmatched: number;
}

export type PgnColorOverride = 'white' | 'black' | null;

const SPLIT_RE = /\r?\n\r?\n(?=\[Event\s+")/g;

export function splitMultiGamePgn(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized.length === 0) return [];
  if (!/^\[Event\s+"/.test(normalized)) {
    return [normalized];
  }
  return normalized
    .split(SPLIT_RE)
    .map((g) => g.trim())
    .filter((g) => g.length > 0);
}

async function pgnHash(pgn: string): Promise<string> {
  const bytes = new TextEncoder().encode(pgn.trim());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function parsePgnDate(value: string | undefined, time: string | undefined): string | null {
  if (!value) return null;
  const date = value.replace(/\./g, '-').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const t = time && /^\d{2}:\d{2}(:\d{2})?$/.test(time.trim()) ? time.trim() : '00:00:00';
  const tFull = t.length === 5 ? `${t}:00` : t;
  const iso = `${date}T${tFull}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function deriveResult(headers: Record<string, string>): string | null {
  const r = headers.Result?.trim();
  if (!r) return null;
  if (r === '1-0' || r === '0-1' || r === '1/2-1/2') return r;
  return null;
}

type GamePlatform = 'lichess' | 'chess.com' | 'pgn';

interface PreparedRow {
  pgn: string;
  row: GameInsert;
  platform: GamePlatform;
  externalId: string;
  /** Content hash — the legacy key every upload used before source ids. */
  pgnHash: string;
  hadHeaders: boolean;
  /** Whether the entered name matched the White/Black headers. */
  matched: boolean;
}

/**
 * The site game a PGN was exported from, when its headers say so. Lichess
 * writes the URL in Site; chess.com in Link.
 */
export function pgnSourceGame(
  pgn: string,
  headers: Record<string, string>,
): { platform: 'lichess' | 'chess.com'; id: string } | null {
  const lichessId = extractLichessGameId(headers.Site);
  if (lichessId) return { platform: 'lichess', id: lichessId };
  const chesscomId = extractChesscomGameId(null, pgn);
  if (chesscomId) return { platform: 'chess.com', id: chesscomId };
  return null;
}

/** True when the entered name matches the PGN's White or Black header. */
export function pgnNameMatches(pgn: string, userPgnName: string): boolean {
  const headers = extractHeaders(pgn);
  const lowerName = userPgnName.trim().toLowerCase();
  if (!lowerName) return false;
  return (
    (headers.White ?? '').toLowerCase() === lowerName ||
    (headers.Black ?? '').toLowerCase() === lowerName
  );
}

async function preparePgn(
  pgn: string,
  userPgnName: string,
  colorOverride: PgnColorOverride,
): Promise<PreparedRow> {
  const headers = extractHeaders(pgn);
  const hash = await pgnHash(pgn);
  const lowerName = userPgnName.trim().toLowerCase();
  const white = headers.White ?? '';
  const black = headers.Black ?? '';
  const isWhite = white.toLowerCase() === lowerName;
  const isBlack = black.toLowerCase() === lowerName;
  const matched = isWhite || isBlack;
  const username = isWhite ? white : isBlack ? black : userPgnName.trim();
  // With an override on an unmatched game, the opponent is the named player on
  // the other side (if the headers carry one).
  const opponent = isWhite
    ? black
    : isBlack
      ? white
      : colorOverride === 'white'
        ? black || 'Unknown'
        : colorOverride === 'black'
          ? white || 'Unknown'
          : white || black || 'Unknown';
  const userColor: 'white' | 'black' | null = isWhite
    ? 'white'
    : isBlack
      ? 'black'
      : colorOverride;
  const playedAt = parsePgnDate(headers.UTCDate ?? headers.Date, headers.UTCTime ?? headers.StartTime);
  // A user's own Lichess / chess.com export is stored as that site's game,
  // keyed by its game id, so a later sync of the same account recognises it
  // instead of importing (and analyzing) it a second time. Someone else's
  // games (name not in the headers) stay plain uploads.
  const source = matched ? pgnSourceGame(pgn, headers) : null;
  const platform: GamePlatform = source?.platform ?? 'pgn';
  const externalId = source?.id ?? hash;

  const row: GameInsert = {
    platform,
    username,
    opponent: opponent || 'Unknown',
    pgn,
    time_control: headers.TimeControl ?? null,
    rated: platform === 'lichess' ? isLichessRated(headers) : false,
    result: deriveResult(headers),
    played_at: playedAt,
    external_game_id: externalId,
    user_color: userColor,
  };

  return {
    pgn,
    row,
    platform,
    externalId,
    pgnHash: hash,
    hadHeaders: Object.keys(headers).length > 0,
    matched,
  };
}

export async function uploadPgns(args: {
  pgnText: string;
  userPgnName: string;
  /** Side the user played in games whose headers don't name them. */
  colorOverride?: PgnColorOverride;
  onProgress?: (p: PgnUploadProgress) => void;
}): Promise<PgnUploadResult> {
  const { pgnText, userPgnName, colorOverride = null, onProgress } = args;
  const pgns = splitMultiGamePgn(pgnText);
  if (pgns.length === 0) {
    return { totalGames: 0, inserted: 0, duplicates: 0, blundersFound: 0, unmatched: 0 };
  }

  onProgress?.({ phase: 'parsing', current: 0, total: pgns.length, blundersFound: 0 });

  const prepared: PreparedRow[] = [];
  for (let i = 0; i < pgns.length; i++) {
    prepared.push(await preparePgn(pgns[i], userPgnName, colorOverride));
    onProgress?.({ phase: 'parsing', current: i + 1, total: pgns.length, blundersFound: 0 });
  }
  const unmatched = prepared.filter((p) => !p.matched).length;

  // Existing keys per platform the file touches. The 'pgn' hashes always
  // load too: games uploaded before source ids existed are keyed by hash.
  const platforms = new Set<GamePlatform>(['pgn', ...prepared.map((p) => p.platform)]);
  const existing = new Set<string>();
  for (const platform of platforms) {
    for (const id of await supabaseService.getExistingExternalGameIds(platform)) {
      existing.add(`${platform}|${id}`);
    }
  }
  const seenInBatch = new Set<string>();
  const fresh = prepared.filter((p) => {
    const key = `${p.platform}|${p.externalId}`;
    if (existing.has(key) || existing.has(`pgn|${p.pgnHash}`)) return false;
    if (seenInBatch.has(key)) return false;
    seenInBatch.add(key);
    return true;
  });
  const duplicates = prepared.length - fresh.length;

  onProgress?.({ phase: 'inserting', current: 0, total: fresh.length, blundersFound: 0 });

  let insertedIds: string[] = [];
  if (fresh.length > 0) {
    try {
      const rows = await classifyGameRowsForInsert(fresh.map((p) => p.row));
      const inserted = await supabaseService.insertGames(rows);
      insertedIds = inserted.map((g) => g.id);
      console.info('[pgn-upload] inserted games', {
        ids: insertedIds,
        playedAt: inserted.map((g) => g.playedAt?.toISOString() ?? null),
      });
    } catch (e) {
      const err = e as { code?: string; message?: string; details?: string; hint?: string } | null;
      // 23505 = unique_violation -> race with concurrent insert, treat as no-op.
      if (err?.code === '23505') {
        insertedIds = [];
      } else {
        const parts = [err?.message, err?.details, err?.hint].filter(Boolean);
        const msg = parts.length > 0 ? parts.join(' — ') : 'Failed to save games';
        throw new Error(msg);
      }
    }
  }

  onProgress?.({
    phase: 'inserting',
    current: fresh.length,
    total: fresh.length,
    blundersFound: 0,
  });

  let blundersFound = 0;
  if (insertedIds.length > 0) {
    onProgress?.({
      phase: 'analyzing',
      current: 0,
      total: insertedIds.length,
      blundersFound: 0,
    });
    const result = await analyzeGames(insertedIds, userPgnName.trim(), (p) => {
      onProgress?.({
        phase: 'analyzing',
        current: p.gameIndex,
        total: p.gamesTotal,
        blundersFound: p.blundersFound,
      });
    });
    blundersFound = result.blundersFound;
  }

  onProgress?.({
    phase: 'done',
    current: insertedIds.length,
    total: insertedIds.length,
    blundersFound,
  });

  return {
    totalGames: prepared.length,
    inserted: insertedIds.length,
    duplicates,
    blundersFound,
    unmatched,
  };
}
