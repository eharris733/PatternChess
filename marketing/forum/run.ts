// Scans public Lichess / Chess.com forum listings and shortlists threads worth
// a personal reply. No API costs, no drafting, no posting — it just reads
// public pages slowly and writes a local page for you to go through.
//   npm run forum:find
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadEnv } from '../ad/env.ts';
import {
  lichessThreads,
  lichessSearchThreads,
  chesscomThreads,
  chesscomSearchThreads,
  fetchBody,
  requestsUsed,
  setLichessSession,
  hasLichessSession,
  MAX_REQUESTS,
  type Thread,
} from './sources.ts';
import { shortlist, judge, loadSeen, saveSeen, type Scored } from './score.ts';

// Chess.com only by default (bigger, paying audience). FORUM_SITES=chess.com,lichess adds Lichess.
const SITES = (process.env.FORUM_SITES ?? 'chess.com').split(',');
const threads: Thread[] = [];
if (SITES.includes('lichess')) {
  setLichessSession(loadEnv().LICHESS_SESSION);
  console.log(hasLichessSession() ? 'Lichess: signed in, searching the forum…' : 'Lichess: no LICHESS_SESSION in .env.local, skipping forum search.');
  threads.push(...(await lichessSearchThreads()), ...(await lichessThreads()));
}
if (SITES.includes('chess.com')) {
  console.log('Chess.com: searching competitor names, then reading category listings…');
  threads.push(...(await chesscomSearchThreads()), ...(await chesscomThreads()));
}
const seen = loadSeen();
const candidates = shortlist(threads, seen);
console.log(`${threads.length} threads listed, ${candidates.length} worth opening (keyword or question title).`);

const judged: Scored[] = [];
for (const c of candidates) {
  if (requestsUsed() >= MAX_REQUESTS) break;
  const searchUrl = c.url;
  if (!(await fetchBody(c))) continue;
  seen.add(searchUrl);
  // Several search hits can land on one topic; judge it once.
  if (judged.some((j) => j.url === c.url) || (c.url !== searchUrl && seen.has(c.url))) continue;
  const j = judge(c);
  seen.add(j.url); // each thread is only ever surfaced once
  judged.push(j);
}
saveSeen(seen);

const order = { pursue: 0, maybe: 1, skip: 2 } as const;
judged.sort((a, b) => order[a.verdict] - order[b.verdict] || b.score - a.score);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const snippet = (s = '') => {
  const clean = s.replace('[thread already mentions PatternChess]', '').trim();
  return clean.length > 320 ? `${clean.slice(0, 320)}…` : clean;
};
const day = new Date().toISOString().slice(0, 10);
const card = (t: Scored) => `
  <article class="${t.verdict}">
    <header>
      <span class="tag v">${t.verdict}</span><span class="tag">${t.site}</span><span class="tag">score ${t.score}</span>
      <a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.title)}</a>
    </header>
    <p class="meta">${t.replies} replies · last active ${t.lastActivity?.toISOString().slice(0, 10) ?? '?'}</p>
    <ul>${t.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    ${t.body ? `<blockquote>${esc(snippet(t.body))}</blockquote>` : ''}
  </article>`;
const competitor = judged.filter((t) => t.section === 'competitor');
const leads = judged.filter((t) => t.section === 'leads');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Forum leads ${day}</title>
<style>
:root{--bg:#1e1b18;--card:#2a2622;--ink:#efe8df;--muted:#b9ad9f;--line:#433c35;--gold:#d4a24c}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif;padding:24px 16px}
main{max-width:760px;margin:0 auto}h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 4px}
.note{color:var(--muted);margin:0 0 20px}
article{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:12px}
article.pursue{border-color:var(--gold)}article.skip{opacity:.55}
header{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}header a{color:var(--ink);font-weight:600}
.tag{font-size:12px;border:1px solid var(--line);border-radius:999px;padding:1px 8px;color:var(--muted)}
.pursue .v{color:var(--gold);border-color:var(--gold)}
.meta{color:var(--muted);margin:6px 0}ul{margin:6px 0;padding-left:20px;color:var(--muted)}
blockquote{margin:8px 0 0;padding:8px 12px;border-left:3px solid var(--line);color:var(--ink)}
</style></head><body><main>
<h1>Forum leads · ${day}</h1>
<p class="note">${leads.filter((t) => t.verdict === 'pursue').length} worth pursuing, ${leads.filter((t) => t.verdict === 'maybe').length} maybe, ${competitor.length} competitor complaints. Each thread shows up once; the rest are skipped for good.</p>
<h2>Competitor complaints</h2>
<p class="note">People unhappy with Duolingo chess, ChessSigma, ChessReps or AI-built chess apps.</p>
${competitor.map(card).join('\n') || '<p class="note">None today.</p>'}
<h2>Improvement leads</h2>
${leads.map(card).join('\n') || '<p class="note">Nothing on-topic today.</p>'}
</main></body></html>`;

const outDir = new URL('./out/', import.meta.url);
mkdirSync(outDir, { recursive: true });
const outFile = new URL(`${day}.html`, outDir);
writeFileSync(outFile, html);
console.log(`\n${judged.length} judged → ${outFile.pathname} (${requestsUsed()} page requests)`);
