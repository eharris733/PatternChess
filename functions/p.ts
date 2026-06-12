import { decodeSharedPuzzle } from '../src/services/puzzleShareService';

interface Env {
  ASSETS: Fetcher;
}

/**
 * Per-puzzle Open Graph tags for shared links. Link unfurlers (iMessage,
 * Slack, WhatsApp…) read the served HTML without running JS, so the static
 * SPA shell always previews as the generic brand card — this function rewrites
 * the meta tags server-side from the `d` payload instead. The SPA itself is
 * untouched: the body streams through unmodified and PuzzleRoute still decodes
 * the payload client-side.
 */

// Mirrors public/_headers, which only applies to statically-served assets —
// Function responses must carry the cross-origin-isolation headers themselves
// or Stockfish drops to single-threaded on /p.
const ISOLATION_HEADERS: Record<string, string> = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function withResponseHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [key, value] of Object.entries(ISOLATION_HEADERS)) {
    out.headers.set(key, value);
  }
  // The HTML varies per `d` payload.
  out.headers.set('Cache-Control', 'no-store');
  return out;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  // `/index.html` 308-redirects under Pages' pretty-URL normalization; `/` is
  // the canonical path for the shell.
  const shell = await env.ASSETS.fetch(new URL('/', url));

  const d = url.searchParams.get('d');
  const puzzle = d ? decodeSharedPuzzle(d) : null;
  if (!d || !puzzle) return withResponseHeaders(shell);

  const sideToMove = puzzle.stm === 'white' ? 'White' : 'Black';
  const title = `${puzzle.lbl ?? 'Chess puzzle'} — ${sideToMove} to move`;
  const description = puzzle.op
    ? `${puzzle.op}. Can you find the best move?`
    : 'Can you find the best move? Train on real blunders with PatternChess.';
  // /og/p proxies Lichess's FEN→GIF export and re-colors the squares to the
  // app's exact board palette (see functions/og/p.ts).
  const image = `${url.origin}/og/p?d=${encodeURIComponent(d)}`;
  const shareUrl = `${url.origin}/p?d=${encodeURIComponent(d)}`;

  // setAttribute / setInnerContent escape their input, and we only ever modify
  // tags that already exist in index.html — never insert raw HTML — so the
  // attacker-controlled lbl/op fields can't break out of the attributes.
  const content = (value: string) => ({
    element(el: Element) {
      el.setAttribute('content', value);
    },
  });

  const rewriter = new HTMLRewriter()
    .on('title', {
      element(el: Element) {
        el.setInnerContent(title);
      },
    })
    .on('meta[name="description"]', content(description))
    .on('meta[property="og:title"]', content(title))
    .on('meta[property="og:description"]', content(description))
    .on('meta[property="og:image"]', content(image))
    .on('meta[property="og:image:width"]', content('720'))
    .on('meta[property="og:image:height"]', content('720'))
    .on('meta[property="og:url"]', content(shareUrl))
    // The board GIF is square; summary_large_image would crop it to ~2:1.
    .on('meta[name="twitter:card"]', content('summary'))
    .on('meta[name="twitter:title"]', content(title))
    .on('meta[name="twitter:description"]', content(description))
    .on('meta[name="twitter:image"]', content(image));

  return withResponseHeaders(rewriter.transform(shell));
};
