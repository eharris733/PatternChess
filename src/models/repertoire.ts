import { bookEpd } from '../chess/bookFormat';

export type RepertoireColor = 'white' | 'black';

/** One chosen move: in this position (as this colour) I play `uci`. */
export interface RepertoireMove {
  id: string;
  color: RepertoireColor;
  /** FEN minus the move counters — the opening book's EPD. */
  epd: string;
  uci: string;
  san: string;
  createdAt: Date;
}

/** Lookup by `${color}|${epd}`; one move per position per colour. */
export type RepertoireMap = Map<string, RepertoireMove>;

export function repertoireKey(color: RepertoireColor, fen: string): string {
  return `${color}|${bookEpd(fen)}`;
}

export function buildRepertoireMap(moves: RepertoireMove[]): RepertoireMap {
  return new Map(moves.map((m) => [`${m.color}|${m.epd}`, m]));
}

/** The user's repertoire move for this position (side to move = `color`), if any. */
export function repertoireMoveFor(
  map: RepertoireMap | null | undefined,
  color: RepertoireColor,
  fen: string,
): RepertoireMove | null {
  return map?.get(repertoireKey(color, fen)) ?? null;
}
