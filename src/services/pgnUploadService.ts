import { analyzeGames } from './analysisService';
import { extractHeaders, parsePgnMetadata } from './pgnParserService';
import { supabaseService } from './supabaseService';

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
}

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

interface PreparedRow {
  pgn: string;
  row: Record<string, unknown>;
  externalId: string;
  hadHeaders: boolean;
}

async function preparePgn(
  pgn: string,
  userPgnName: string,
): Promise<PreparedRow> {
  const headers = extractHeaders(pgn);
  const externalId = await pgnHash(pgn);
  const lowerName = userPgnName.trim().toLowerCase();
  const white = headers.White ?? '';
  const black = headers.Black ?? '';
  const isWhite = white.toLowerCase() === lowerName;
  const isBlack = black.toLowerCase() === lowerName;
  const username = isWhite ? white : isBlack ? black : userPgnName.trim();
  const opponent = isWhite ? black : isBlack ? white : (white || black || 'Unknown');
  const playedAt = parsePgnDate(headers.UTCDate ?? headers.Date, headers.UTCTime ?? headers.StartTime);

  const row: Record<string, unknown> = {
    platform: 'pgn',
    username,
    opponent: opponent || 'Unknown',
    pgn,
    time_control: headers.TimeControl ?? null,
    rated: false,
    result: deriveResult(headers),
    played_at: playedAt,
    external_game_id: externalId,
  };

  return {
    pgn,
    row,
    externalId,
    hadHeaders: Object.keys(headers).length > 0,
  };
}

export async function uploadPgns(args: {
  pgnText: string;
  userPgnName: string;
  onProgress?: (p: PgnUploadProgress) => void;
}): Promise<PgnUploadResult> {
  const { pgnText, userPgnName, onProgress } = args;
  const pgns = splitMultiGamePgn(pgnText);
  if (pgns.length === 0) {
    return { totalGames: 0, inserted: 0, duplicates: 0, blundersFound: 0 };
  }

  onProgress?.({ phase: 'parsing', current: 0, total: pgns.length, blundersFound: 0 });

  const prepared: PreparedRow[] = [];
  for (let i = 0; i < pgns.length; i++) {
    prepared.push(await preparePgn(pgns[i], userPgnName));
    onProgress?.({ phase: 'parsing', current: i + 1, total: pgns.length, blundersFound: 0 });
  }

  const existing = await supabaseService.getExistingExternalGameIds('pgn');
  const seenInBatch = new Set<string>();
  const fresh = prepared.filter((p) => {
    if (existing.has(p.externalId)) return false;
    if (seenInBatch.has(p.externalId)) return false;
    seenInBatch.add(p.externalId);
    return true;
  });
  const duplicates = prepared.length - fresh.length;

  onProgress?.({ phase: 'inserting', current: 0, total: fresh.length, blundersFound: 0 });

  let insertedIds: string[] = [];
  if (fresh.length > 0) {
    try {
      const inserted = await supabaseService.insertGames(fresh.map((p) => p.row));
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
  };
}
