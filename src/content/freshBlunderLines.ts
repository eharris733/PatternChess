/**
 * Celebration lines for blunders found in newly synced games (dashboard
 * FreshBlundersCard). Blunders are fuel: each line should make finding one
 * feel like progress. Placeholders: {n} = new blunders, {games} = new games.
 * No emoji, no "not X, but Y" constructions.
 */

const PLURAL_LINES = [
  '{n} fresh blunders found. That\'s {n} steps closer to GM.',
  'You are {n} blunders closer to being a GM.',
  '{games} games, {n} blunders. Fresh fuel just landed in your queue.',
  'Good news: you blundered. {n} new positions to train.',
  'Your games just paid out: {n} new positions to train.',
  '{n} blunders found. Painful in the game, useful in the queue.',
  '{games} games in, {n} lessons out.',
  '{n} new blunders. The woodpecker is hungry.',
  'Blunder count: {n}. Excuses: zero. Let\'s train.',
  '{n} fresh blunders. Let\'s make sure each one only happens once.',
  'You played {games} games and left us {n} presents. Unwrap the first one.',
  '{n} new positions with your name on them.',
  'Every grandmaster had a pile like this once. Yours just grew by {n}.',
  '{n} chances you let slip on the board. Time to go collect them.',
  'Freshly harvested from {games} games: {n} blunders, ready to drill.',
];

const SINGULAR_LINE = 'One new blunder. Small, but it counts.';
const ZERO_LINE = '{games} games, zero trainable blunders. Who are you and what have you done with the old you?';

function fill(line: string, n: number, games: number): string {
  return line.replaceAll('{n}', String(n)).replaceAll('{games}', String(games));
}

/**
 * The line for a sync that added `games` games and `n` blunders. `seed` picks
 * the plural line deterministically (same sync → same line across renders).
 * Lines that mention {games} read wrong for a single game, so they're skipped then.
 */
export function freshBlunderLine(n: number, games: number, seed: number): string {
  if (n <= 0) return fill(ZERO_LINE, n, games);
  if (n === 1) return SINGULAR_LINE;
  const pool = games > 1 ? PLURAL_LINES : PLURAL_LINES.filter((l) => !l.includes('{games}'));
  const idx = Math.abs(Math.floor(seed)) % pool.length;
  return fill(pool[idx], n, games);
}
