import { Chess } from 'chess.js';

/**
 * A puzzle shared as a self-contained link: the whole payload travels in the
 * URL (base64url JSON), so the public /p route needs no database access and
 * works for logged-out visitors. Keys are short to keep links compact.
 */
export interface SharedPuzzle {
  v: 1;
  /** Position before the blunder. */
  fen: string;
  /** The move played in the game (UCI). */
  pm: string;
  /** Accepted moves with their evals (centipawns, mover's perspective). */
  cm: { m: string; e: number }[];
  /** Eval before the move (centipawns, mover's perspective). */
  eb: number;
  /** Eval after the move (centipawns, opponent's perspective). */
  ea: number;
  /** Side to move. */
  stm: 'white' | 'black';
  /** Optional players label, e.g. "WhiteName vs BlackName". */
  lbl?: string;
  /** Optional opening label. */
  op?: string;
}

const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
/** correctMoves can grow unboundedly via the accept rule — cap the link size. */
const MAX_CORRECT_MOVES = 5;

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function encodeSharedPuzzle(p: Omit<SharedPuzzle, 'v'>): string {
  const payload: SharedPuzzle = {
    v: 1,
    fen: p.fen,
    pm: p.pm,
    cm: p.cm.slice(0, MAX_CORRECT_MOVES),
    eb: p.eb,
    ea: p.ea,
    stm: p.stm,
    ...(p.lbl ? { lbl: p.lbl } : {}),
    ...(p.op ? { op: p.op } : {}),
  };
  return toBase64Url(JSON.stringify(payload));
}

/** Strict decode — returns null on any malformed or tampered payload. */
export function decodeSharedPuzzle(encoded: string): SharedPuzzle | null {
  const json = fromBase64Url(encoded);
  if (!json) return null;

  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return null;
  if (typeof raw.fen !== 'string') return null;
  try {
    new Chess(raw.fen);
  } catch {
    return null;
  }
  if (typeof raw.pm !== 'string' || !UCI_RE.test(raw.pm)) return null;
  if (!Array.isArray(raw.cm)) return null;
  const cm: { m: string; e: number }[] = [];
  for (const item of raw.cm.slice(0, MAX_CORRECT_MOVES)) {
    if (
      !item ||
      typeof item.m !== 'string' ||
      !UCI_RE.test(item.m) ||
      typeof item.e !== 'number' ||
      !Number.isFinite(item.e)
    ) {
      return null;
    }
    cm.push({ m: item.m, e: item.e });
  }
  if (typeof raw.eb !== 'number' || !Number.isFinite(raw.eb)) return null;
  if (typeof raw.ea !== 'number' || !Number.isFinite(raw.ea)) return null;
  if (raw.stm !== 'white' && raw.stm !== 'black') return null;

  return {
    v: 1,
    fen: raw.fen,
    pm: raw.pm,
    cm,
    eb: raw.eb,
    ea: raw.ea,
    stm: raw.stm,
    ...(typeof raw.lbl === 'string' && raw.lbl.length > 0 ? { lbl: raw.lbl.slice(0, 120) } : {}),
    ...(typeof raw.op === 'string' && raw.op.length > 0 ? { op: raw.op.slice(0, 120) } : {}),
  };
}
