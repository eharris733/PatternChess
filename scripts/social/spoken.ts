// Moves and brand names as the narrator says them. Pure (unit-tested).
//
// Scripts are written in spoken form ("queen takes h7, check"), and the
// on-screen captions show the same words, so captions and voice never disagree.
// Kokoro reads squares and ratings fine ("h7", "2056"); pronounce() only fixes
// the brand.

const PIECE: Record<string, string> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight' };
const PROMO: Record<string, string> = { Q: 'a queen', R: 'a rook', B: 'a bishop', N: 'a knight' };

/** "Qxh7+" → "queen takes h7, check"; "exd5" → "e takes d5"; "O-O" → "castles". */
export function spokenSan(san: string): string {
  const check = san.endsWith('#') ? 'checkmate' : san.endsWith('+') ? 'check' : '';
  const core = san.replace(/[+#?!]+$/, '');
  let words: string;
  if (core === 'O-O') words = 'castles';
  else if (core === 'O-O-O') words = 'castles long';
  else {
    const m = /^([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=([QRBN]))?$/.exec(core);
    if (!m) return san;
    const [, piece, fromFile, , takes, to, promo] = m;
    const parts: string[] = [];
    if (piece) parts.push(PIECE[piece]);
    else if (takes && fromFile) parts.push(fromFile); // pawn capture names its file
    if (takes) parts.push('takes');
    parts.push(to);
    words = parts.join(' ');
    if (promo) words += `, promotes to ${PROMO[promo]}`;
  }
  return check ? `${words}, ${check}` : words;
}

/** The squares a SAN move names (destination, plus the file for pawn captures is not a square). */
export function sanSquares(san: string): string[] {
  return [...san.matchAll(/[a-h][1-8]/g)].map((m) => m[0]);
}

/** What the TTS reads: the caption text with the brand made sayable. */
export function pronounce(text: string): string {
  return text
    .replace(/patternchess\.com/gi, 'pattern chess dot com')
    .replace(/PatternChess/g, 'Pattern Chess')
    .replace(/\s+/g, ' ')
    .trim();
}
