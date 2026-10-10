// LLM-free "is this thread worth my time?" scoring.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { KEYWORDS, OWN_MENTION, NOISE, PROMO, COMPLAINT, competitorMention } from './queries.ts';
import type { Thread } from './sources.ts';

const MAX_AGE_DAYS = 30;
const SEARCH_MAX_AGE_DAYS = 90; // search hits are rarer, so older ones still count
const MAX_REPLIES = 50;
const CROWDED_REPLIES = 15; // past this, a new reply mostly goes unread
const SEEN_PATH = new URL('./seen.json', import.meta.url);

export type Verdict = 'pursue' | 'maybe' | 'skip';
export type Section = 'leads' | 'competitor';
export type Scored = Thread & { score: number; topics: string[]; reasons: string[]; verdict: Verdict; section: Section };

// FORUM_IGNORE_SEEN=1: re-judge already-surfaced threads (for tuning) without recording them.
export const IGNORE_SEEN = process.env.FORUM_IGNORE_SEEN === '1';

export function loadSeen(): Set<string> {
  if (IGNORE_SEEN) return new Set();
  return existsSync(SEEN_PATH) ? new Set(JSON.parse(readFileSync(SEEN_PATH, 'utf8'))) : new Set();
}

export function saveSeen(seen: Set<string>) {
  if (IGNORE_SEEN) return;
  writeFileSync(SEEN_PATH, JSON.stringify([...seen], null, 2));
}

function topicScore(text: string) {
  let score = 0;
  const topics: string[] = [];
  for (const k of KEYWORDS) {
    if (k.pattern.test(text)) {
      score += k.weight;
      topics.push(k.topic);
    }
  }
  return { score, topics };
}

// Cheap first pass on the listing (title only): which threads deserve a page load.
export function shortlist(threads: Thread[], seen: Set<string>): Scored[] {
  const now = Date.now();
  const unique = new Map(threads.map((t) => [t.url, t]));
  return [...unique.values()]
    .filter((t) => !seen.has(t.url))
    .filter((t) => t.replies <= MAX_REPLIES)
    .filter((t) => !t.lastActivity || now - t.lastActivity.getTime() <= (t.fromSearch ? SEARCH_MAX_AGE_DAYS : MAX_AGE_DAYS) * 86_400_000)
    .filter((t) => !OWN_MENTION.test(t.title))
    // A competitor in the title outranks the noise filter ("which is better…").
    .filter((t) => competitorMention(t.title) || !NOISE.test(t.title))
    .map((t) => {
      const { score, topics } = topicScore(`${t.title}\n${t.body ?? ''}`);
      // Generic titles ("Need help", "Advice?") often hide on-topic posts, so
      // question-shaped titles stay in the queue behind keyword hits.
      const question = /\?|help|advice|tips|how|why|improve/i.test(t.title) ? 1 : 0;
      const competitor = competitorMention(`${t.title}\n${t.body ?? ''}`) ? 6 : 0;
      return { ...t, score: score * 2 + question + competitor, topics, reasons: [], verdict: 'maybe' as Verdict, section: 'leads' as Section };
    })
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score || (b.lastActivity?.getTime() ?? 0) - (a.lastActivity?.getTime() ?? 0));
}

// Full verdict once the first post is loaded.
export function judge(t: Scored): Scored {
  const body = t.body ?? '';
  const { score, topics } = topicScore(`${t.title}\n${body}`);
  const reasons: string[] = [];
  let s = score;
  if (topics.length) reasons.push(`on topic: ${topics.join(', ')}`);

  const asking = /\?|\b(how|why|what) (do|can|to|should|is|am|did)\b|any (tips|advice)|help|what should i|don't understand/i.test(`${t.title} ${body.slice(0, 400)}`);
  // Nearly every thread asks something, so this only nudges; topics decide.
  if (asking) { s += 1; reasons.push('asks for advice'); }
  else reasons.push('not phrased as a question');

  if (t.replies <= 5) { s += 2; reasons.push(`early (${t.replies} replies) — a reply gets seen`); }
  else if (t.replies > CROWDED_REPLIES) { s -= 2; reasons.push(`crowded (${t.replies} replies)`); }

  const ageDays = t.lastActivity ? (Date.now() - t.lastActivity.getTime()) / 86_400_000 : null;
  if (ageDays !== null && ageDays <= 3) { s += 1; reasons.push('active in the last 3 days'); }

  if (body.length > 0 && body.length < 40) { s -= 1; reasons.push('very short first post'); }
  if (t.replies > MAX_REPLIES) return { ...t, score: s, topics, reasons: [`crowded (${t.replies}+ replies)`], verdict: 'skip' };
  if (body.includes('[thread already mentions PatternChess]')) return { ...t, score: s, topics, reasons: ['already mentions PatternChess'], verdict: 'skip' };

  // Unhappy with a competitor: its own section, judged on tone + freshness
  // rather than topic match. Checked before PROMO so "this app called X is
  // garbage" isn't mistaken for a pitch; someone pitching their own app is.
  const text = `${t.title}\n${body}`;
  const rival = competitorMention(text);
  if (rival && COMPLAINT.test(text) && !/\b(i|we) (just )?(built|made|created|launched)\b/i.test(body)) {
    const cs = s + 3;
    const why = [`unhappy with ${rival}`, ...reasons.filter((r) => !r.startsWith('on topic'))];
    return { ...t, score: cs, topics, reasons: why, verdict: cs >= 6 ? 'pursue' : 'maybe', section: 'competitor' };
  }

  if (PROMO.test(body)) return { ...t, score: s, topics, reasons: ["someone else's product pitch"], verdict: 'skip' };

  // Engagement signals only rank on-topic threads; they never make an off-topic one worth it.
  const verdict: Verdict = !topics.length ? 'skip' : s >= 6 && asking ? 'pursue' : s >= 4 ? 'maybe' : 'skip';
  if (!topics.length) reasons.unshift('no PatternChess topic');
  return { ...t, score: s, topics, reasons, verdict };
}
