import { describe, expect, it } from 'vitest';
import { pgnSourceGame } from './pgnUploadService';
import { extractHeaders } from './pgnParserService';

function source(pgn: string) {
  return pgnSourceGame(pgn, extractHeaders(pgn));
}

describe('pgnSourceGame', () => {
  it('reads a Lichess export, old and new Site URLs', () => {
    expect(source('[Site "https://lichess.org/game/DeidrzEq"]\n\n1. e4 *')).toEqual({
      platform: 'lichess',
      id: 'DeidrzEq',
    });
    expect(source('[Site "https://lichess.org/DeidrzEq"]\n\n1. e4 *')).toEqual({
      platform: 'lichess',
      id: 'DeidrzEq',
    });
  });

  it('reads a chess.com export from its Link header', () => {
    expect(
      source('[Site "Chess.com"]\n[Link "https://www.chess.com/game/live/123456789"]\n\n1. e4 *'),
    ).toEqual({ platform: 'chess.com', id: '123456789' });
  });

  it('returns null for OTB or unknown sources', () => {
    expect(source('[Site "Reykjavik ISL"]\n\n1. e4 *')).toBeNull();
    expect(source('1. e4 e5 *')).toBeNull();
  });
});
