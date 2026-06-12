import { decodeSharedPuzzle } from '../../src/services/puzzleShareService';

interface Env {
  ASSETS: Fetcher;
}

/**
 * Board image for shared-puzzle link previews. Proxies Lichess's FEN→GIF
 * export and byte-patches the GIF's global color table so the squares use the
 * app's exact board palette — Lichess's named themes can't be customized, and
 * its closest ("brown") has noticeably warmer dark squares than ours.
 */

// App default board palette (src/styles/themes.css) ← Lichess "brown" palette.
const SWAPS: ReadonlyArray<{ from: [number, number, number]; to: [number, number, number] }> = [
  { from: [0xef, 0xd8, 0xb3], to: [0xf0, 0xd9, 0xb5] }, // light squares
  { from: [0xb5, 0x88, 0x63], to: [0xc0, 0xad, 0x90] }, // dark squares
];

/**
 * Rewrite board colors inside the GIF's global color table — header bytes
 * only, no image decoding. If Lichess ever changes its palette the swaps
 * simply no-op and the image keeps Lichess's colors.
 */
function patchPalette(gif: Uint8Array): Uint8Array {
  const isGif = gif.length > 13 && gif[0] === 0x47 && gif[1] === 0x49 && gif[2] === 0x46;
  if (!isGif) return gif;
  const packed = gif[10];
  if (!(packed & 0x80)) return gif; // no global color table
  const entries = 2 ** ((packed & 0x07) + 1);
  const end = Math.min(13 + entries * 3, gif.length);
  for (let o = 13; o + 2 < end; o += 3) {
    for (const { from, to } of SWAPS) {
      if (gif[o] === from[0] && gif[o + 1] === from[1] && gif[o + 2] === from[2]) {
        gif[o] = to[0];
        gif[o + 1] = to[1];
        gif[o + 2] = to[2];
      }
    }
  }
  return gif;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;
  const cached = await caches.default.match(request);
  if (cached) return cached;

  const url = new URL(request.url);
  const d = url.searchParams.get('d');
  const puzzle = d ? decodeSharedPuzzle(d) : null;

  // Never 500 a link unfurler — fall back to the static brand card.
  const fallback = async (maxAge: number) => {
    const card = await env.ASSETS.fetch(new URL('/social-card-og.png', url));
    const out = new Response(card.body, card);
    out.headers.set('Cache-Control', `public, max-age=${maxAge}`);
    return out;
  };
  if (!puzzle) return fallback(3600);

  // `color` orients the board with the solver's side at the bottom. No
  // lastMove highlight — the FEN is the position *before* the blunder.
  const upstream = await fetch(
    `https://lichess.org/export/fen.gif?${new URLSearchParams({
      fen: puzzle.fen,
      color: puzzle.stm,
      theme: 'brown',
      piece: 'cburnett',
    })}`,
    { headers: { 'User-Agent': 'patternchess.com link previews' } },
  );
  // Lichess down or rate-limited — short cache so unfurlers can retry soon.
  if (!upstream.ok) return fallback(60);

  const gif = patchPalette(new Uint8Array(await upstream.arrayBuffer()));
  const res = new Response(gif, {
    headers: {
      'Content-Type': 'image/gif',
      // Payload-addressed: the same `d` always renders the same image, and the
      // edge cache keeps repeat unfurls off Lichess's rate limit.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
  ctx.waitUntil(caches.default.put(request, res.clone()));
  return res;
};
