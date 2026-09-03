import { describe, expect, it } from 'vitest';
import {
  classifyEndgameType,
  ENDGAME_TYPE_LABEL,
  ENDGAME_TYPE_ORDER,
  isOppositeColoredBishops,
} from './endgameType';

describe('classifyEndgameType', () => {
  it.each([
    ['4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', 'pawn'],
    ['4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'pawn'],
    ['4k3/r7/8/8/8/8/4P3/R3K3 w - - 0 1', 'rook'],
    ['4k3/8/8/8/8/8/1B1N4/4K3 w - - 0 1', 'minor'],
    ['4k3/8/8/8/8/8/8/3QK3 w - - 0 1', 'queen'],
    ['4k3/r7/8/8/8/8/1B6/R3K3 w - - 0 1', 'rook-minor'],
    ['3qk3/8/8/8/8/8/1N6/3QK3 w - - 0 1', 'queen-minor'],
    ['4k3/r7/8/8/8/8/8/3QK3 w - - 0 1', 'mixed'],
    ['4k3/b7/8/8/8/8/8/4K2R w - - 0 1', 'rook-minor'],
  ] as const)('%s → %s', (fen, type) => {
    expect(classifyEndgameType(fen)).toBe(type);
  });
});

describe('isOppositeColoredBishops', () => {
  it('is true for one bishop each on opposite colours (pawns allowed)', () => {
    // White Bc1 (dark), black Bc8 (light).
    expect(isOppositeColoredBishops('2b1k3/pp6/8/8/8/8/PP6/2B1K3 w - - 0 1')).toBe(true);
  });
  it('is false for same-coloured bishops or extra pieces', () => {
    // White Bc1 (dark), black Bf8 (dark).
    expect(isOppositeColoredBishops('4kb2/8/8/8/8/8/8/2B1K3 w - - 0 1')).toBe(false);
    expect(isOppositeColoredBishops('2b1k3/8/8/8/8/8/8/2B1K2R w - - 0 1')).toBe(false);
  });
});

it('every type has a label and a place in the order', () => {
  expect([...ENDGAME_TYPE_ORDER].sort()).toEqual(Object.keys(ENDGAME_TYPE_LABEL).sort());
});
