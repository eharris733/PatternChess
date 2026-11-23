import type { Translator } from '../i18n/useT';

/**
 * Celebration lines for blunders found in newly synced games (dashboard
 * FreshBlundersCard). Blunders are fuel: each line should make finding one
 * feel like progress. Placeholders: {n} = new blunders, {games} = new games.
 * No emoji, no "not X, but Y" constructions. Translations live in the i18n
 * catalogs as `fresh.<index>` / `fresh.singular` / `fresh.zero`, in this order.
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
export function freshBlunderLine(n: number, games: number, seed: number, t?: Translator): string {
  if (n <= 0) return t ? t('fresh.zero', { n, games }) : fill(ZERO_LINE, n, games);
  if (n === 1) return t ? t('fresh.singular') : SINGULAR_LINE;
  const pool = PLURAL_LINES.map((line, i) => ({ line, i })).filter(
    ({ line }) => games > 1 || !line.includes('{games}'),
  );
  const pick = pool[Math.abs(Math.floor(seed)) % pool.length];
  // `fresh.0` … `fresh.14` mirror PLURAL_LINES index for index.
  return t ? t(`fresh.${pick.i}` as 'fresh.0', { n, games }) : fill(pick.line, n, games);
}
