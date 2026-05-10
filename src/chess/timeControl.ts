/** Parse Lichess ("180+2") and Chess.com ("60") time-control headers into centiseconds. */
export function parseStartIncrement(
  timeControl: string | null,
): { startCs: number; incCs: number } | null {
  if (!timeControl) return null;
  const m = timeControl.match(/^(\d+)(?:\+(\d+))?$/);
  if (!m) return null;
  const startCs = Number.parseInt(m[1], 10) * 100;
  const incCs = m[2] ? Number.parseInt(m[2], 10) * 100 : 0;
  if (!Number.isFinite(startCs)) return null;
  return { startCs, incCs };
}
