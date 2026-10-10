// Read-only fetchers for public, logged-out forum pages. No cookies, no login,
// no posting — and if a site challenges us (Cloudflare), we skip it rather
// than work around it.

export type Thread = {
  site: 'lichess' | 'chess.com';
  url: string;
  title: string;
  replies: number;
  lastActivity: Date | null;
  body?: string; // first post (plain text), filled in by fetchBody
  fromSearch?: boolean; // found by keyword search (older threads still count)
};

const UA = 'PatternChess-research/1.0 (+mailto:elliotmharris@gmail.com)';
const DELAY_MS = 3000;
export const MAX_REQUESTS = 80;

let requests = 0;
let lastAt = 0;

export function requestsUsed() {
  return requests;
}

// Lichess session (the `lila2` cookie from your browser, in .env.local as
// LICHESS_SESSION). Only ever sent to lichess.org. Optional: without it the
// Lichess search step is skipped and only category listings are read.
let lichessCookie: string | null = null;
export function setLichessSession(cookie: string | undefined) {
  lichessCookie = cookie ? `lila2=${cookie.replace(/^lila2=/, '')}` : null;
}
export const hasLichessSession = () => lichessCookie !== null;

async function get(url: string): Promise<{ html: string; url: string } | null> {
  if (requests >= MAX_REQUESTS) {
    console.log(`  [cap] ${MAX_REQUESTS} requests reached, skipping ${url}`);
    return null;
  }
  const wait = lastAt + DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  requests++;
  lastAt = Date.now();
  console.log(`  [${new Date().toISOString().slice(11, 19)}] GET ${url}`);
  const headers: Record<string, string> = { 'User-Agent': UA };
  if (lichessCookie && new URL(url).hostname === 'lichess.org') headers.Cookie = lichessCookie;
  const res = await fetch(url, { headers });
  const html = await res.text();
  if (/\/(signup|login)\b/.test(new URL(res.url).pathname)) {
    console.log(`  [skipped] redirected to ${new URL(res.url).pathname} — Lichess session missing or expired`);
    return null;
  }
  if (res.status !== 200 || /<title>Just a moment/.test(html)) {
    console.log(`  [skipped] ${res.status} ${res.status === 200 ? '(challenge page)' : ''} ${url}`);
    return null;
  }
  return { html, url: res.url };
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

// ---- Lichess (forum search needs a login, so we read category listings) ----

const LICHESS_CATEGORIES = ['general-chess-discussion', 'game-analysis'];
const LICHESS_PAGES = 3;

export async function lichessThreads(): Promise<Thread[]> {
  const out: Thread[] = [];
  for (const cat of LICHESS_CATEGORIES) {
    for (let page = 1; page <= LICHESS_PAGES; page++) {
      const html = (await get(`https://lichess.org/forum/${cat}?page=${page}`))?.html;
      if (!html) break;
      for (const row of html.match(/<tr>.*?<\/tr>/gs) ?? []) {
        const link = row.match(/<td class="subject"><a href="(\/forum\/[^"#?]+)">(.*?)<\/a>/s);
        if (!link) continue;
        const replies = Number(row.match(/<td class="right">(\d+)<\/td>/)?.[1] ?? 0);
        const time = row.match(/datetime="([^"]+)"/)?.[1];
        out.push({
          site: 'lichess',
          url: `https://lichess.org${link[1]}`,
          title: decode(link[2]),
          replies,
          lastActivity: time ? new Date(time) : null,
        });
      }
    }
  }
  return out;
}

// Forum search (signed-in only). One page of results per query.
const LICHESS_SEARCHES = [
  'woodpecker',
  'spaced repetition',
  'same mistakes',
  'review my games',
  'stop blundering',
  'winning endgame',
  'opening repertoire',
];

export async function lichessSearchThreads(): Promise<Thread[]> {
  if (!lichessCookie) return [];
  const out: Thread[] = [];
  for (const q of LICHESS_SEARCHES) {
    const html = (await get(`https://lichess.org/forum/search?text=${encodeURIComponent(q)}`))?.html;
    if (!html) break; // an expired session fails every query the same way
    for (const row of html.match(/<tr class="paginated stack-row">.*?<\/tr>/gs) ?? []) {
      const link = row.match(/<a class="post" href="(\/forum\/redirect\/post\/[^"]+)">(.*?)<\/a>/s);
      if (!link) continue;
      const time = row.match(/datetime="([^"]+)"/)?.[1];
      out.push({
        site: 'lichess',
        url: `https://lichess.org${link[1]}`,
        // "General Chess Discussion - Topic name" → "Topic name"
        title: decode(link[2]).replace(/^[^-]+ - /, ''),
        replies: -1, // unknown until the topic is opened
        lastActivity: time ? new Date(time) : null,
        body: decode(row.match(/<p>(.*?)<\/p>/s)?.[1] ?? ''),
      });
    }
  }
  return out;
}

// ---- Chess.com ----

// Categories where improvement questions get asked (of the 23 on /forum).
const CHESSCOM_CATEGORIES = ['general', 'game-analysis', 'chess-openings', 'endgames', 'for-beginners', 'chess-lessons'];
const CHESSCOM_PAGES = 2;

function parseChesscomRows(html: string): Thread[] {
  const out: Thread[] = [];
  for (const row of html.match(/<tr class="forums-category-thread-row.*?<\/tr>/gs) ?? []) {
    const link = row.match(/href="(https:\/\/www\.chess\.com\/forum\/view\/[^"?#]+)"\s+class="forums-category-thread-title[^"]*">(.*?)<\/a>/s);
    if (!link) continue;
    const replies = Number(row.match(/<td class="forums-category-thread-posts">\s*([\d,]+)/)?.[1].replace(/,/g, '') ?? 0);
    const time = row.match(/<span title="([^"]+)">[^<]*<\/span>\s*<\/div>\s*<\/td>\s*<\/tr>/)?.[1];
    const parsed = time ? new Date(time.replace(/,(?=\s\d+:)/, '')) : null;
    out.push({
      site: 'chess.com',
      url: link[1],
      title: decode(link[2].replace(/<span[\s\S]*?<\/span>/g, '')),
      replies,
      lastActivity: parsed && !isNaN(parsed.getTime()) ? parsed : null,
    });
  }
  return out;
}

export async function chesscomThreads(): Promise<Thread[]> {
  const out: Thread[] = [];
  for (const cat of CHESSCOM_CATEGORIES) for (let page = 1; page <= CHESSCOM_PAGES; page++) {
    const html = (await get(`https://www.chess.com/forum/category/${cat}${page > 1 ? `?page=${page}` : ''}`))?.html;
    if (!html) break;
    out.push(...parseChesscomRows(html));
  }
  return out;
}

// Forum search works logged out. Used for competitor names, which rarely show
// up in the newest-threads listings. One page of results per term.
const CHESSCOM_SEARCHES = ['duolingo', 'chesssigma', 'chess sigma', 'chessreps', 'chess reps', 'vibe coded', 'ai slop'];

export async function chesscomSearchThreads(): Promise<Thread[]> {
  const out: Thread[] = [];
  for (const q of CHESSCOM_SEARCHES) {
    const html = (await get(`https://www.chess.com/forum/search?keyword=${encodeURIComponent(q)}`))?.html;
    if (!html) continue;
    out.push(...parseChesscomRows(html).map((t) => ({ ...t, fromSearch: true })));
  }
  return out;
}

// First post of a thread, for the drafter and the "already mentioned" check.
export async function fetchBody(t: Thread): Promise<boolean> {
  const page = await get(t.url);
  if (!page) return false;
  const { html } = page;
  if (t.site === 'lichess') {
    // Search hits link to /forum/redirect/post/<id>; settle on the topic itself.
    const topic = new URL(page.url);
    topic.search = '';
    topic.hash = '';
    t.url = topic.toString();
    if (t.replies < 0) {
      // Search hits don't carry a count: estimate from pagination (10 posts/page).
      const pages = Math.max(1, ...[...html.matchAll(/[?&]page=(\d+)/g)].map((m) => Number(m[1])));
      const onPage = (html.match(/<article class="forum-post/g) ?? []).length;
      t.replies = pages > 1 ? pages * 10 : Math.max(0, onPage - 1);
    }
    const posts = [...html.matchAll(/<div class="forum-post__message-source">(.*?)<\/div>/gs)].map((m) => decode(m[1]));
    // Keep a search hit's matching snippet alongside the first post.
    const snippet = t.body && !posts[0]?.startsWith(t.body.slice(0, 60)) ? `\n${t.body}` : '';
    t.body = (posts[0] ?? '') + snippet;
    // Keep the rest only for the mention check.
    if (posts.slice(1).some((p) => /patternchess/i.test(p))) t.body += '\n[thread already mentions PatternChess]';
  } else {
    const desc = html.match(/<meta property="og:description" content="([^"]*)"/)?.[1] ?? '';
    t.body = decode(desc);
    if (/patternchess/i.test(html)) t.body += '\n[thread already mentions PatternChess]';
  }
  return true;
}
