import { describe, expect, it } from 'vitest';
import { parseDepth, parseInfoLine, parsePrincipalVariation } from './uci';

const SEARCH_OUTPUT = [
  'info depth 10 seldepth 14 multipv 1 score cp 31 nodes 51234 nps 812000 pv e2e4 e7e5 g1f3',
  'info depth 11 currmove d2d4 currmovenumber 2',
  'info depth 12 seldepth 18 multipv 1 score cp 34 nodes 130111 nps 815000 pv e2e4 e7e5 g1f3 b8c6',
  'bestmove e2e4 ponder e7e5',
].join('\n');

describe('parseDepth', () => {
  it('returns the deepest completed iteration', () => {
    expect(parseDepth(SEARCH_OUTPUT)).toBe(12);
  });

  it('ignores currmove progress lines that carry no score', () => {
    const out = [
      'info depth 12 seldepth 18 score cp 34 pv e2e4',
      'info depth 13 currmove d2d4 currmovenumber 2',
      'bestmove e2e4',
    ].join('\n');
    expect(parseDepth(out)).toBe(12);
  });

  it('does not confuse seldepth for depth', () => {
    // Reversed field order would only match via a bug in the word boundary.
    const out = 'info depth 8 seldepth 30 score cp 10 pv a2a4\nbestmove a2a4';
    expect(parseDepth(out)).toBe(8);
  });

  it('parses mate-score lines', () => {
    const out = 'info depth 21 seldepth 25 score mate 3 pv d8h4\nbestmove d8h4';
    expect(parseDepth(out)).toBe(21);
  });

  it('returns null when the engine reported no scored line', () => {
    expect(parseDepth('bestmove (none)')).toBeNull();
    expect(parseDepth('')).toBeNull();
  });
});

describe('parsePrincipalVariation', () => {
  it('caps at maxMoves and reads the deepest info line', () => {
    expect(parsePrincipalVariation(SEARCH_OUTPUT, 2)).toEqual(['e2e4', 'e7e5']);
    expect(parsePrincipalVariation(SEARCH_OUTPUT, 10)).toEqual([
      'e2e4',
      'e7e5',
      'g1f3',
      'b8c6',
    ]);
  });
});

describe('parseInfoLine', () => {
  it('parses depth and cp from a scored line', () => {
    expect(parseInfoLine('info depth 18 seldepth 25 multipv 1 score cp -1043 nodes 1 nps 1 pv a1a2')).toEqual({
      depth: 18,
      cp: -1043,
      bound: false,
    });
  });

  it('maps mate scores like parseEvalCp', () => {
    expect(parseInfoLine('info depth 20 score mate 3 pv a1a8')?.cp).toBe(9997);
    expect(parseInfoLine('info depth 20 score mate -2 pv a1a8')?.cp).toBe(-9998);
  });

  it('flags fail-high/low iterations', () => {
    expect(parseInfoLine('info depth 22 score cp 1200 lowerbound nodes 5 pv a1a2')?.bound).toBe(true);
    expect(parseInfoLine('info depth 22 score cp -1200 upperbound nodes 5 pv a1a2')?.bound).toBe(true);
  });

  it('returns null for unscored and non-info lines', () => {
    expect(parseInfoLine('info depth 13 currmove d2d4 currmovenumber 2')).toBeNull();
    expect(parseInfoLine('info string NNUE evaluation using nn.nnue')).toBeNull();
    expect(parseInfoLine('bestmove e2e4 ponder e7e5')).toBeNull();
  });
});
