import { Chess } from 'chess.js';
import { parseUciMove } from '../../chess/moveUtils';
import { MOTIF_LABEL } from '../../chess/motifs';
import { DRILL_KIND_LABEL, PHASE_LABEL, SR_BUCKET_LABEL, type Blunder } from '../../models/blunder';
import { orderedPlayers, type GameRecord } from '../../models/gameRecord';
import type { GameLink } from '../../services/db/vault';
import { COLOR_LABEL, localYmd, type PositionFacts } from './vaultFilters';

/**
 * Vault export: the current filtered set as a CSV (one row per position, for
 * a spreadsheet) or a PGN (one game per position, starting from the position
 * with `[SetUp "1"]` + `[FEN]`, the solution as the main line and the move
 * you played as a variation), for Lichess studies, ChessBase and the like.
 */

export interface ExportPosition {
  facts: PositionFacts;
  link: GameLink | null;
}

// --- moves ---------------------------------------------------------------------

interface SanMove {
  san: string;
  /** Full-move number and side of the move, for PGN numbering. */
  moveNumber: number;
  white: boolean;
}

/** Play UCI moves from `fen`, stopping at the first illegal one. */
export function playUci(fen: string, ucis: readonly string[]): SanMove[] {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return [];
  }
  const out: SanMove[] = [];
  for (const uci of ucis) {
    const white = chess.turn() === 'w';
    const moveNumber = chess.moveNumber();
    try {
      const m = parseUciMove(uci);
      const res = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
      out.push({ san: res.san, moveNumber, white });
    } catch {
      break;
    }
  }
  return out;
}

/** The answer line in UCI: the stored engine PV when it starts with the best move, else the best move. */
export function solutionUci(b: Blunder): string[] {
  const best = b.correctMoves[0]?.move;
  const pv = b.solutionLine?.pv ?? [];
  if (pv.length > 0 && (!best || pv[0] === best)) return [...pv];
  return best ? [best] : [];
}

/** "12. Nf3 Nc6 13. Bb5" / "12... Nc6 13. Bb5". */
export function numberedLine(moves: readonly SanMove[]): string {
  return moves
    .map((m, i) => (m.white ? `${m.moveNumber}. ${m.san}` : i === 0 ? `${m.moveNumber}... ${m.san}` : m.san))
    .join(' ');
}

// --- links -----------------------------------------------------------------------

/** Plies played before this FEN's position (its full-move number and side to move). */
export function fenPly(fen: string): number | null {
  const [, side, , , , full] = fen.split(' ');
  const n = Number(full);
  if (!Number.isInteger(n) || n < 1 || (side !== 'w' && side !== 'b')) return null;
  return (n - 1) * 2 + (side === 'b' ? 1 : 0);
}

/**
 * The game on the site it came from. Lichess links open at the position and
 * from the user's side; uploaded PGNs have no site, so no link.
 */
export function gameUrl(link: GameLink | null, opts: { fen?: string; color?: 'white' | 'black' } = {}): string | null {
  if (!link?.externalGameId) return null;
  const id = encodeURIComponent(link.externalGameId);
  if (link.platform === 'lichess') {
    const ply = opts.fen ? fenPly(opts.fen) : null;
    return `https://lichess.org/${id}${opts.color === 'black' ? '/black' : ''}${ply !== null ? `#${ply}` : ''}`;
  }
  if (link.platform === 'chess.com') {
    // Daily games have a "moves/seconds-per-move" control, e.g. "1/86400".
    const daily = /^\d+\/\d+$/.test(link.timeControl ?? '');
    return `https://www.chess.com/game/${daily ? 'daily' : 'live'}/${id}`;
  }
  return null;
}

// --- CSV -------------------------------------------------------------------------

export const CSV_COLUMNS = [
  'Date',
  'Type',
  'Progress',
  'Phase',
  'Color',
  'Opening',
  'Motifs',
  'FEN',
  'Move',
  'Played move',
  'Best move',
  'Solution line',
  'Game link',
] as const;

/** RFC 4180 quoting; a leading formula character is defused so spreadsheets show it as text. */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function moveLabel(fen: string): string {
  const parts = fen.split(' ');
  return `${parts[5] ?? '?'}${parts[1] === 'b' ? '...' : '.'}`;
}

export function positionsToCsv(items: readonly ExportPosition[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const { facts, link } of items) {
    const b = facts.blunder;
    const played = playUci(b.fen, [b.playedMove])[0]?.san ?? b.playedMove;
    const solution = playUci(b.fen, solutionUci(b));
    const row = [
      localYmd(facts.date),
      DRILL_KIND_LABEL[b.kind],
      SR_BUCKET_LABEL[facts.bucket],
      PHASE_LABEL[b.phase],
      COLOR_LABEL[facts.color],
      facts.openingFamily ?? '',
      b.motifs.map((m) => MOTIF_LABEL[m]).join('; '),
      b.fen,
      moveLabel(b.fen),
      played,
      solution[0]?.san ?? '',
      numberedLine(solution),
      gameUrl(link, { fen: b.fen, color: facts.color }) ?? '',
    ];
    lines.push(row.map(csvCell).join(','));
  }
  // BOM so Excel reads UTF-8 (opening names like "Grünfeld").
  return `﻿${lines.join('\r\n')}\r\n`;
}

// --- PGN -------------------------------------------------------------------------

/**
 * A tag pair. The standard allows \" escapes, but chess.js and other readers
 * reject them, so quotes and backslashes are swapped out instead.
 */
function tag(name: string, value: string): string {
  return `[${name} "${value.replace(/\\/g, '/').replace(/"/g, "'").replace(/[\r\n]+/g, ' ')}"]`;
}

function pgnDate(d: Date | null): string {
  if (!d) return '????.??.??';
  return localYmd(d).replace(/-/g, '.');
}

/** PGN comments end at "}", so keep it out of the text. */
function comment(text: string): string {
  return `{${text.replace(/[{}]/g, '')}}`;
}

/** Wrap movetext at 79 columns (PGN export format), never inside a token. */
function wrap(tokens: readonly string[], width = 79): string {
  const lines: string[] = [];
  let line = '';
  for (const t of tokens) {
    if (line && line.length + 1 + t.length > width) {
      lines.push(line);
      line = t;
    } else {
      line = line ? `${line} ${t}` : t;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

/** Split a comment into word tokens so `wrap` can break long comments too. */
function commentTokens(text: string): string[] {
  const words = comment(text).split(' ');
  return words.filter((w) => w.length > 0);
}

/**
 * Movetext tokens for one line, a move number kept with its move so wrapping
 * never splits them. A black move is numbered ("5... Na5") when it opens the
 * line or follows a variation (`numberBlack`).
 */
function lineTokens(moves: readonly SanMove[], opts: { nag?: string; numberBlack?: boolean } = {}): string[] {
  const out: string[] = [];
  moves.forEach((m, i) => {
    if (m.white) out.push(`${m.moveNumber}. ${m.san}`);
    else if (i === 0 && opts.numberBlack !== false) out.push(`${m.moveNumber}... ${m.san}`);
    else out.push(m.san);
    if (i === 0 && opts.nag) out.push(opts.nag);
  });
  return out;
}

function playedComment(b: Blunder, played: SanMove | undefined): string {
  const move = played
    ? `${played.moveNumber}${played.white ? '.' : '...'} ${played.san}`
    : b.playedMove;
  const motifs = b.motifs.map((m) => MOTIF_LABEL[m]);
  return motifs.length > 0 ? `You played ${move} in the game. ${motifs.join(', ')}.` : `You played ${move} in the game.`;
}

function players(game: GameRecord | null): [string, string] {
  if (!game) return ['?', '?'];
  return orderedPlayers(game.username || '?', game.opponent || '?', game.userColor);
}

/** One PGN game for one position. */
export function positionToPgn({ facts, link }: ExportPosition): string {
  const b = facts.blunder;
  const game = facts.game;
  const [white, black] = players(game);
  const url = gameUrl(link, { fen: b.fen, color: facts.color });
  const tags = [
    tag('Event', `PatternChess Vault: ${DRILL_KIND_LABEL[b.kind]}`),
    tag('Site', url ?? '?'),
    tag('Date', pgnDate(game?.playedAt ?? null)),
    tag('Round', '-'),
    tag('White', white),
    tag('Black', black),
    tag('Result', '*'),
    tag('SetUp', '1'),
    tag('FEN', b.fen),
    tag('Annotator', 'PatternChess'),
  ];
  if (game?.eco) tags.push(tag('ECO', game.eco));
  const opening = game?.openingName ?? facts.openingFamily;
  if (opening) tags.push(tag('Opening', opening));

  // Blunders get "??"; opening exits and endgame slips cost less, so "?".
  const nag = b.kind === 'tactic' ? '$4' : '$2';
  const playedLine = playUci(b.fen, [b.playedMove, ...(b.solutionLine?.playedPv ?? [])]);
  const solution = playUci(b.fen, solutionUci(b));
  const tokens: string[] = [...commentTokens(playedComment(b, playedLine[0]))];

  if (solution.length === 0) {
    // No stored answer: the played line is all there is.
    tokens.push(...lineTokens(playedLine, { nag }));
  } else {
    const [first, ...rest] = solution;
    tokens.push(...lineTokens([first]));
    const hasVariation = playedLine.length > 0 && playedLine[0].san !== first.san;
    if (hasVariation) {
      const variation = lineTokens(playedLine, { nag });
      variation[0] = `(${variation[0]}`;
      variation[variation.length - 1] = `${variation[variation.length - 1]})`;
      tokens.push(...variation);
    }
    // After a variation, a black move needs its number again.
    tokens.push(...lineTokens(rest, { numberBlack: hasVariation }));
  }
  tokens.push('*');
  return `${tags.join('\n')}\n\n${wrap(tokens)}\n`;
}

export function positionsToPgn(items: readonly ExportPosition[]): string {
  return items.map(positionToPgn).join('\n');
}

// --- files -----------------------------------------------------------------------

export function exportFilename(mode: 'blunders' | 'mastered', ext: 'csv' | 'pgn', now = new Date()): string {
  return `patternchess-${mode}-${localYmd(now)}.${ext}`;
}
