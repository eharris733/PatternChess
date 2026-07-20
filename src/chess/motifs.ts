import { Chess } from 'chess.js';
import type { Move } from 'chess.js';
import { CASTLING_NORMALIZE, parseUciMove } from './moveUtils';

/**
 * Tactical motif tagging, ported from the heuristics in lichess-puzzler's
 * tagger (cook.py): themes are detected by walking an engine line (PV) from a
 * position and inspecting the board states it produces. Each detector runs
 * twice per blunder — over the solution line (what the user failed to play →
 * `missed*`) and over the refutation of the played move (what the user let
 * the opponent do → `allowed*`/`leftPieceHanging`). Detectors are biased
 * toward precision: a quiet or ambiguous line simply yields no tag.
 */

export type Motif =
  | 'hangingPiece'
  | 'leftPieceHanging'
  | 'missedMate'
  | 'allowedMate'
  | 'missedFork'
  | 'allowedFork'
  | 'missedSkewer'
  | 'allowedSkewer'
  | 'missedPin'
  | 'allowedPin'
  | 'missedDiscoveredAttack'
  | 'allowedDiscoveredAttack'
  | 'backRankWeakness'
  | 'trappedPiece'
  | 'defensiveMistake';

/** UI text — single source of truth, like SR_BUCKET_LABEL. */
export const MOTIF_LABEL: Record<Motif, string> = {
  hangingPiece: 'Missed hanging piece',
  leftPieceHanging: 'Left a piece hanging',
  missedMate: 'Missed mate',
  allowedMate: 'Allowed mate',
  missedFork: 'Missed fork',
  allowedFork: 'Allowed fork',
  missedSkewer: 'Missed skewer',
  allowedSkewer: 'Allowed skewer',
  missedPin: 'Missed pin',
  allowedPin: 'Allowed pin',
  missedDiscoveredAttack: 'Missed discovered attack',
  allowedDiscoveredAttack: 'Allowed discovered attack',
  backRankWeakness: 'Back-rank weakness',
  trappedPiece: 'Trapped piece',
  defensiveMistake: 'Defensive mistake',
};

export const ALL_MOTIFS = Object.keys(MOTIF_LABEL) as Motif[];

export function parseMotifs(v: unknown): Motif[] {
  if (!Array.isArray(v)) return [];
  return v.filter((m): m is Motif => typeof m === 'string' && m in MOTIF_LABEL);
}

export interface MotifInput {
  /** Position before the blunder (user to move). */
  fen: string;
  playedMove: string;
  /** Best-move PV from `fen`. */
  solutionPv: string[];
  /** Refutation PV from the position after the played move. */
  playedRefutationPv: string[];
  /** Eval at `fen`, from the user's (side-to-move) perspective. */
  evalBefore: number;
  /** Eval after the played move, from the opponent's perspective. */
  evalAfter: number;
}

/** parseEvalCp maps "mate in N" to ±(10000 − N). */
const MATE_EVAL_ABS = 9000;

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 99 };

type Color = 'w' | 'b';
type ThemeSet = {
  mate: boolean;
  backRank: boolean;
  hangingCapture: boolean;
  fork: boolean;
  skewer: boolean;
  pin: boolean;
  discoveredAttack: boolean;
  trapped: boolean;
};

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

const FILES = 'abcdefgh';
const sqName = (file: number, rank: number) => `${FILES[file]}${rank + 1}`;
const fileOf = (sq: string) => FILES.indexOf(sq[0]);
const rankOf = (sq: string) => Number(sq[1]) - 1;
const onBoard = (file: number, rank: number) => file >= 0 && file < 8 && rank >= 0 && rank < 8;

const ROOK_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const BISHOP_DIRS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

function raysFor(pieceType: string): ReadonlyArray<readonly [number, number]> {
  if (pieceType === 'r') return ROOK_DIRS;
  if (pieceType === 'b') return BISHOP_DIRS;
  if (pieceType === 'q') return [...ROOK_DIRS, ...BISHOP_DIRS];
  return [];
}

/** First occupied square walking from `from` in direction `dir` (exclusive). */
function firstPieceOnRay(
  chess: Chess,
  from: string,
  dir: readonly [number, number],
): { square: string; type: string; color: Color } | null {
  let f = fileOf(from) + dir[0];
  let r = rankOf(from) + dir[1];
  while (onBoard(f, r)) {
    const sq = sqName(f, r);
    const p = chess.get(sq as any);
    if (p) return { square: sq, type: p.type, color: p.color as Color };
    f += dir[0];
    r += dir[1];
  }
  return null;
}

/** Squares strictly between two aligned squares (empty result if not aligned). */
function between(a: string, b: string): string[] {
  const df = Math.sign(fileOf(b) - fileOf(a));
  const dr = Math.sign(rankOf(b) - rankOf(a));
  const fd = Math.abs(fileOf(b) - fileOf(a));
  const rd = Math.abs(rankOf(b) - rankOf(a));
  if (!(fd === 0 || rd === 0 || fd === rd) || (fd === 0 && rd === 0)) return [];
  const out: string[] = [];
  let f = fileOf(a) + df;
  let r = rankOf(a) + dr;
  while (f !== fileOf(b) || r !== rankOf(b)) {
    out.push(sqName(f, r));
    f += df;
    r += dr;
  }
  return out;
}

/**
 * A piece on `square` hangs to `attacker` when it is attacked and either
 * undefended or attackable by a strictly cheaper piece (mirrors the spirit of
 * lichess-puzzler's util.is_hanging).
 */
function isHanging(chess: Chess, square: string, attacker: Color): boolean {
  const piece = chess.get(square as any);
  if (!piece || piece.color === attacker) return false;
  const attackers = chess.attackers(square as any, attacker);
  if (attackers.length === 0) return false;
  const defenders = chess.attackers(square as any, other(attacker));
  if (defenders.length === 0) return true;
  const cheapest = Math.min(...attackers.map((sq) => VALUE[chess.get(sq)?.type ?? 'p']));
  return cheapest < VALUE[piece.type];
}

interface LinePly {
  fenBefore: string;
  fenAfter: string;
  move: Move;
}

/** Replay a PV; cut at the first illegal ply. */
function replayLine(fen: string, pv: string[]): LinePly[] {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return [];
  }
  const out: LinePly[] = [];
  for (const rawUci of pv) {
    const uci = CASTLING_NORMALIZE[rawUci] ?? rawUci;
    const m = parseUciMove(uci);
    const fenBefore = chess.fen();
    let move: Move;
    try {
      move = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    } catch {
      break;
    }
    if (!move) break;
    out.push({ fenBefore, fenAfter: chess.fen(), move });
  }
  return out;
}

/**
 * Scan a line for tactical themes executed by the side to move at `fen`
 * (the "pov" side — its moves are the even plies).
 */
function detectLineThemes(fen: string, pv: string[]): ThemeSet {
  const themes: ThemeSet = {
    mate: false,
    backRank: false,
    hangingCapture: false,
    fork: false,
    skewer: false,
    pin: false,
    discoveredAttack: false,
    trapped: false,
  };
  const plies = replayLine(fen, pv);
  if (plies.length === 0) return themes;
  const pov = plies[0].move.color as Color;
  const opp = other(pov);

  // --- mate + back-rank ---
  const last = plies[plies.length - 1];
  if (last.move.color === pov) {
    const endState = new Chess(last.fenAfter);
    if (endState.isCheckmate()) {
      themes.mate = true;
      themes.backRank = isBackRankMate(endState, last.move, opp);
    }
  }

  // --- hanging piece: the first pov move snaps an undefended piece ---
  const first = plies[0];
  {
    const start = new Chess(first.fenBefore);
    if (
      !start.inCheck() &&
      first.move.captured &&
      first.move.captured !== 'p' &&
      isHanging(start, first.move.to, pov)
    ) {
      themes.hangingCapture = true;
    }
  }

  for (let i = 0; i < plies.length; i += 2) {
    const ply = plies[i];
    const after = new Chess(ply.fenAfter);
    const m = ply.move;

    // --- fork: the moved piece attacks 2+ pieces it profitably targets ---
    if (m.piece !== 'k' && !themes.fork && !isHanging(after, m.to, opp)) {
      let targets = 0;
      for (const row of after.board()) {
        for (const cell of row) {
          if (!cell || cell.color !== opp) continue;
          const attackedBy = after.attackers(cell.square as any, pov);
          if (!attackedBy.includes(m.to as any)) continue;
          if (
            cell.type === 'k' ||
            VALUE[cell.type] > VALUE[m.piece] ||
            (cell.type !== 'p' && isHanging(after, cell.square, pov))
          ) {
            targets++;
          }
        }
      }
      if (targets >= 2) themes.fork = true;
    }

    // --- skewer: ray attack on a big piece; it steps off the ray and the
    //     piece standing behind it falls two plies later ---
    if (!themes.skewer && raysFor(m.piece).length > 0 && i + 2 < plies.length) {
      for (const dir of raysFor(m.piece)) {
        const frontP = firstPieceOnRay(after, m.to, dir);
        if (!frontP || frontP.color !== opp) continue;
        if (frontP.type !== 'k' && VALUE[frontP.type] <= VALUE[m.piece]) continue;
        const behind = firstPieceOnRay(after, frontP.square, dir);
        if (!behind || behind.color !== opp) continue;
        const reply = plies[i + 1].move;
        const followUp = plies[i + 2].move;
        if (
          reply.from === frontP.square &&
          !between(m.to, behind.square).includes(reply.to) &&
          reply.to !== behind.square &&
          followUp.to === behind.square &&
          followUp.captured
        ) {
          themes.skewer = true;
          break;
        }
      }
    }

    // --- pin: an opponent piece is absolutely pinned and gets won ---
    if (!themes.pin) {
      const kingSq = findKing(after, opp);
      if (kingSq) {
        outer: for (const dir of [...ROOK_DIRS, ...BISHOP_DIRS]) {
          const pinned = firstPieceOnRay(after, kingSq, dir);
          if (!pinned || pinned.color !== opp || pinned.type === 'k') continue;
          const pinner = firstPieceOnRay(after, pinned.square, dir);
          if (!pinner || pinner.color !== pov) continue;
          const rookLike = dir[0] === 0 || dir[1] === 0;
          if (!(pinner.type === 'q' || pinner.type === (rookLike ? 'r' : 'b'))) continue;
          // Exploited: the pinned piece hangs, or a later pov ply captures it.
          if (isHanging(after, pinned.square, pov)) {
            themes.pin = true;
            break outer;
          }
          for (let j = i + 2; j < plies.length; j += 2) {
            if (plies[j].move.captured && plies[j].move.to === pinned.square) {
              themes.pin = true;
              break outer;
            }
          }
        }
      }
    }

    // --- discovered attack: the departure square opened a ray onto a big
    //     target (or the king) ---
    if (!themes.discoveredAttack) {
      for (const row of after.board()) {
        for (const cell of row) {
          if (!cell || cell.color !== pov || cell.square === m.to) continue;
          for (const dir of raysFor(cell.type)) {
            const target = firstPieceOnRay(after, cell.square, dir);
            if (!target || target.color !== opp) continue;
            if (!between(cell.square, target.square).includes(m.from)) continue;
            if (
              target.type === 'k' ||
              VALUE[target.type] >= 5 ||
              isHanging(after, target.square, pov)
            ) {
              themes.discoveredAttack = true;
            }
          }
        }
      }
    }

    // --- trapped: an attacked piece has no safe square and is then won ---
    if (!themes.trapped) {
      for (const row of after.board()) {
        for (const cell of row) {
          if (!cell || cell.color !== opp || cell.type === 'p' || cell.type === 'k') continue;
          const mustMove = isHanging(after, cell.square, pov)
            ? true
            : after
                .attackers(cell.square as any, pov)
                .some((sq) => VALUE[after.get(sq)?.type ?? 'p'] < VALUE[cell.type]);
          if (!mustMove) continue;
          const escapes = after.moves({ square: cell.square as any, verbose: true });
          if (escapes.length === 0) continue; // nothing to judge — skip, king may be forced first
          const allHang = escapes.every((esc) => {
            const probe = new Chess(ply.fenAfter);
            try {
              probe.move({ from: esc.from, to: esc.to, promotion: esc.promotion });
            } catch {
              return true;
            }
            return isHanging(probe, esc.to, pov);
          });
          if (!allHang) continue;
          // Confirmed lost: a later pov ply captures a piece of that value.
          for (let j = i + 2; j < plies.length; j += 2) {
            const cap = plies[j].move;
            if (cap.captured && VALUE[cap.captured] === VALUE[cell.type]) {
              themes.trapped = true;
              break;
            }
          }
        }
      }
    }
  }

  return themes;
}

function findKing(chess: Chess, color: Color): string | null {
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.color === color && cell.type === 'k') return cell.square;
    }
  }
  return null;
}

/** Mate on the loser's home rank by a rank-sliding piece, escape blocked by own pawns. */
function isBackRankMate(endState: Chess, matingMove: Move, matedColor: Color): boolean {
  const kingSq = findKing(endState, matedColor);
  if (!kingSq) return false;
  const homeRank = matedColor === 'w' ? 0 : 7;
  if (rankOf(kingSq) !== homeRank) return false;
  if (!(matingMove.piece === 'r' || matingMove.piece === 'q')) return false;
  if (rankOf(matingMove.to) !== homeRank) return false;
  const escapeRank = matedColor === 'w' ? 1 : 6;
  const kf = fileOf(kingSq);
  let ownPawnBlocks = 0;
  for (const f of [kf - 1, kf, kf + 1]) {
    if (!onBoard(f, escapeRank)) continue;
    const p = endState.get(sqName(f, escapeRank) as any);
    if (p && p.color === matedColor && p.type === 'p') ownPawnBlocks++;
  }
  return ownPawnBlocks >= 2;
}

function applyUci(fen: string, uci: string): string | null {
  try {
    const chess = new Chess(fen);
    const std = CASTLING_NORMALIZE[uci] ?? uci;
    const m = parseUciMove(std);
    if (!chess.move({ from: m.from, to: m.to, promotion: m.promotion })) return null;
    return chess.fen();
  } catch {
    return null;
  }
}

export function detectMotifs(input: MotifInput): Motif[] {
  const motifs = new Set<Motif>();

  // What the best line achieves — the tactic the user missed.
  const missed = detectLineThemes(input.fen, input.solutionPv);
  if (missed.mate) motifs.add('missedMate');
  if (missed.hangingCapture) motifs.add('hangingPiece');
  if (missed.fork) motifs.add('missedFork');
  if (missed.skewer) motifs.add('missedSkewer');
  if (missed.pin) motifs.add('missedPin');
  if (missed.discoveredAttack) motifs.add('missedDiscoveredAttack');
  if (missed.trapped) motifs.add('trappedPiece');
  if (missed.backRank) motifs.add('backRankWeakness');

  // What the played move let the opponent do — the tactic the user allowed.
  const fenAfterPlayed = applyUci(input.fen, input.playedMove);
  if (fenAfterPlayed) {
    const allowed = detectLineThemes(fenAfterPlayed, input.playedRefutationPv);
    if (allowed.mate) motifs.add('allowedMate');
    if (allowed.hangingCapture) motifs.add('leftPieceHanging');
    if (allowed.fork) motifs.add('allowedFork');
    if (allowed.skewer) motifs.add('allowedSkewer');
    if (allowed.pin) motifs.add('allowedPin');
    if (allowed.discoveredAttack) motifs.add('allowedDiscoveredAttack');
    if (allowed.trapped) motifs.add('trappedPiece');
    if (allowed.backRank) motifs.add('backRankWeakness');
  }

  // Mate is also visible in the evals even when the stored PV is truncated.
  if (input.evalBefore >= MATE_EVAL_ABS) motifs.add('missedMate');
  if (input.evalAfter >= MATE_EVAL_ABS) motifs.add('allowedMate');

  // Defensive mistake: the position didn't call for winning anything — the
  // best move was quiet (no capture/check/promotion) from a non-winning
  // position, and the user's move collapsed instead.
  if (input.evalBefore <= 100 && input.solutionPv.length > 0) {
    const plies = replayLine(input.fen, input.solutionPv.slice(0, 1));
    if (plies.length === 1) {
      const m = plies[0].move;
      const after = new Chess(plies[0].fenAfter);
      if (!m.captured && !m.promotion && !after.inCheck()) motifs.add('defensiveMistake');
    }
  }

  return [...motifs];
}
