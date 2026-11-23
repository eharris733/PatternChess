// Tops up the review queue: every day from tomorrow to today+N without a live
// (queued / posted) row gets the next verified puzzle, scripted (Claude, with
// the template as fallback), narrated (Kokoro), rendered and uploaded. Today's
// slot is never filled here — a day you vetoed stays empty instead of getting
// a puzzle nobody reviewed.
//
// Formats alternate by day ("blunder" on even day numbers, "fall" on odd ones);
// when one format has nothing that passes the engine, the day gets the other.
//
//   node scripts/social/plan.ts [--remote] [--days 7] [--local-media <dir>] [--refresh-queued]
//
// --local-media renders into <dir> and stores file:// URLs instead of
// uploading to R2 (local dry runs against the local D1).
// --refresh-queued re-scripts, re-voices and re-renders every queued row from
// tomorrow on (after a change to the look or the voice), keeping its puzzle.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { d1, r2Put, sql, type Target } from './cloudflare.ts';
import { instagramCaption, tiktokCaption } from './copy.ts';
import { verifyPuzzle } from './engine.ts';
import { parseArgs } from './env.ts';
import { prepareFall } from './fall.ts';
import type { RecentHook } from './hooks.ts';
import { buildPuzzle, type Format, type Puzzle } from './puzzle.ts';
import { makeRenderContext, renderPuzzle, type RenderContext } from './render.ts';
import { writeScript, type ScriptSource, type VideoScript } from './script.ts';
import { fetchBlunder, fetchCandidates, fetchFallCandidates, nextCandidate, ownerId, trapBlunderId } from './select.ts';
import { COUNTDOWN_SECONDS } from './timeline.ts';
import { voiceName, voiceScript } from './voice.ts';

const DAY_MS = 86400_000;
/** Engine checks per run (each ~4–8s); rejects are remembered, so later runs dig deeper. */
const MAX_CHECKS = 60;

export function utcToday(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Days tomorrow…today+days that have no live row, in order. */
export function emptySlots(today: string, days: number, taken: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (let i = 1; i <= days; i++) {
    const d = addDays(today, i);
    if (!taken.has(d)) out.push(d);
  }
  return out;
}

/** The format a day prefers: they alternate, so the feed mixes both. */
export function formatForDay(day: string): Format {
  const n = Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
  return n % 2 === 0 ? 'blunder' : 'fall';
}

/** What the review card shows (and what was drawn). */
export function puzzleSummary(p: Puzzle, s: VideoScript) {
  return {
    format: p.format,
    fen: p.fen,
    side: p.side,
    rating: p.rating,
    timeControl: p.timeControl,
    played: p.played.san,
    refutation: p.refutation.map((r) => r.san),
    solution: p.solution.map((r) => r.san),
    motifLabel: p.motifLabel,
    fellCount: p.fellCount,
    headline: s.headline,
    subline: s.subline,
    hook: s.hookStyle,
  };
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export interface Produced {
  script: VideoScript;
  source: ScriptSource;
  voice: string;
  mediaUrl: string;
  posterUrl: string;
  duration: number;
}

/** How far back the hook rotation looks. */
export const HOOK_MEMORY_DAYS = 14;

/** Live rows' hooks as RecentHook, newest first (pure; rows from social_posts). */
export function toRecentHooks(rows: readonly { hook_template: string | null; script: string | null }[]): RecentHook[] {
  const out: RecentHook[] = [];
  for (const r of rows) {
    let s: Partial<VideoScript> | null = null;
    try {
      s = r.script ? (JSON.parse(r.script) as Partial<VideoScript>) : null;
    } catch {
      s = null;
    }
    out.push({ hookStyle: r.hook_template ?? s?.hookStyle ?? '', headline: s?.headline ?? '', hook: s?.beats?.hook ?? '' });
  }
  return out;
}

/**
 * Hooks of live rows scheduled in [from - HOOK_MEMORY_DAYS, through], newest
 * first. `through` excludes the rows a refresh is about to rewrite.
 */
function loadRecentHooks(target: Target, from: string, through: string | null): RecentHook[] {
  const rows = d1<{ hook_template: string | null; script: string | null }>(
    `SELECT hook_template, script FROM social_posts
     WHERE status IN ('queued', 'posted') AND scheduled_for >= ${sql(addDays(from, -HOOK_MEMORY_DAYS))}
     ${through ? `AND scheduled_for <= ${sql(through)}` : ''}
     ORDER BY scheduled_for DESC`,
    target,
  );
  return toRecentHooks(rows);
}

/** Script → voice → render → upload (or a file:// URL with --local-media). Records the new hook in `recent`. */
async function produce(p: Puzzle, day: string, work: string, localMedia: string | null, rc: RenderContext, recent: RecentHook[]): Promise<Produced> {
  const written = await writeScript(p, COUNTDOWN_SECONDS, recent);
  recent.unshift({ hookStyle: written.script.hookStyle, headline: written.script.headline, hook: written.script.beats.hook ?? '' });
  if (written.errors.length) console.log(`    script: ${written.source} (${written.errors.length} rejected: ${written.errors.slice(0, 3).join(' | ')})`);
  const voice = voiceName();
  const track = await voiceScript(written.script.beats, voice);
  const name = `${day}-${shortId()}`;
  const res = await renderPuzzle(p, written.script, track, work, rc, name);
  const mediaUrl = localMedia ? `file://${res.mp4}` : r2Put(res.mp4, `reels/${name}.mp4`, 'video/mp4');
  const posterUrl = localMedia ? `file://${res.poster}` : r2Put(res.poster, `reels/${name}.jpg`, 'image/jpeg');
  return { script: written.script, source: written.source, voice, mediaUrl, posterUrl, duration: res.duration };
}

/** The columns every produced row gets (insert and refresh). */
function producedColumns(p: Puzzle, out: Produced): Record<string, string | number | null> {
  return {
    format: p.format,
    fell_count: p.fellCount,
    hook_template: out.script.hookStyle,
    motif: p.motif,
    caption: instagramCaption(p, out.script),
    tiktok_caption: tiktokCaption(p, out.script),
    puzzle: JSON.stringify(puzzleSummary(p, out.script)),
    script: JSON.stringify(out.script),
    script_source: out.source,
    voice: out.voice,
    media_url: out.mediaUrl,
    poster_url: out.posterUrl,
  };
}

function reject(blunderId: string, fen: string, format: Format, reason: string, target: Target): void {
  d1(
    `INSERT INTO social_posts (id, blunder_id, fen, status, reject_reason, format, created_at)
     VALUES (${[crypto.randomUUID(), blunderId, fen, 'rejected', reason, format, new Date().toISOString()].map(sql).join(', ')})`,
    target,
  );
}

async function fill(target: Target, days: number, localMedia: string | null): Promise<void> {
  const today = utcToday();
  const live = d1<{ scheduled_for: string; motif: string | null }>(
    `SELECT scheduled_for, motif FROM social_posts WHERE status IN ('queued', 'posted') AND scheduled_for >= ${sql(addDays(today, -1))}`,
    target,
  );
  const taken = new Set(live.map((r) => r.scheduled_for));
  const motifByDay = new Map(live.map((r) => [r.scheduled_for, r.motif]));
  const slots = emptySlots(today, days, taken);
  if (slots.length === 0) {
    console.log(`queue full through ${addDays(today, days)}`);
    return;
  }

  const owner = ownerId(target);
  const blunderPool = fetchCandidates(owner, target);
  const fallPool = fetchFallCandidates(target);
  console.log(`${slots.length} empty day(s); ${blunderPool.length} blunder and ${fallPool.length} fall candidate(s)`);
  const recent = loadRecentHooks(target, today, null);
  const rc = await makeRenderContext();
  const work = localMedia ?? mkdtempSync(join(tmpdir(), 'pc-social-'));
  let checks = 0;

  const nextBlunder = async (day: string): Promise<Puzzle | null> => {
    while (checks < MAX_CHECKS) {
      const row = nextCandidate(blunderPool, motifByDay.get(addDays(day, -1)) ?? null);
      if (!row) return null;
      const puzzle = buildPuzzle(row);
      if (!puzzle) continue;
      checks++;
      const verdict = await verifyPuzzle(row.fen, puzzle.solution[0].uci);
      if (verdict.ok) return puzzle;
      console.log(`  reject ${row.id}: ${verdict.reason}`);
      reject(row.id, row.fen, 'blunder', verdict.reason, target);
    }
    return null;
  };
  const nextFall = async (): Promise<Puzzle | null> => {
    while (checks < MAX_CHECKS) {
      const c = fallPool.shift();
      if (!c) return null;
      checks++;
      const res = await prepareFall(c);
      if (res.ok) return res.puzzle;
      console.log(`  reject trap ${c.played_move} @ ${c.fen}: ${res.reason}`);
      reject(trapBlunderId(c.trapKey), c.fen, 'fall', res.reason, target);
    }
    return null;
  };

  try {
    for (const day of slots) {
      const order: Format[] = formatForDay(day) === 'fall' ? ['fall', 'blunder'] : ['blunder', 'fall'];
      let puzzle: Puzzle | null = null;
      for (const f of order) {
        puzzle = f === 'fall' ? await nextFall() : await nextBlunder(day);
        if (puzzle) break;
      }
      if (!puzzle) {
        console.warn(`  ${day}: no verified puzzle (checked ${checks}) — next run tries again`);
        break;
      }
      const out = await produce(puzzle, day, work, localMedia, rc, recent);
      const cols = {
        id: crypto.randomUUID(),
        blunder_id: puzzle.blunderId,
        fen: puzzle.fen,
        scheduled_for: day,
        status: 'queued',
        ...producedColumns(puzzle, out),
        created_at: new Date().toISOString(),
      };
      d1(`INSERT INTO social_posts (${Object.keys(cols).join(', ')}) VALUES (${Object.values(cols).map(sql).join(', ')})`, target);
      motifByDay.set(day, puzzle.motif);
      console.log(`  ${day}: ${puzzle.format} ${puzzle.blunderId.slice(0, 60)} (${out.script.hookStyle}, ${out.source}, ${out.duration.toFixed(1)}s) → ${out.mediaUrl}`);
    }
  } finally {
    if (!localMedia) rmSync(work, { recursive: true, force: true });
  }
}

/** Re-scripts, re-voices and re-renders queued rows from tomorrow on. */
async function refreshQueued(target: Target, localMedia: string | null): Promise<void> {
  const rows = d1<{ id: string; blunder_id: string; fen: string; scheduled_for: string; format: Format | null; fell_count: number | null }>(
    `SELECT id, blunder_id, fen, scheduled_for, format, fell_count FROM social_posts
     WHERE status = 'queued' AND scheduled_for > ${sql(utcToday())} ORDER BY scheduled_for`,
    target,
  );
  // Rows from tomorrow on are about to be rewritten: rotate against what's already out.
  const recent = loadRecentHooks(target, utcToday(), utcToday());
  const rc = await makeRenderContext();
  const work = localMedia ?? mkdtempSync(join(tmpdir(), 'pc-social-'));
  try {
    for (const r of rows) {
      let puzzle: Puzzle | null = null;
      if (r.format === 'fall' || r.blunder_id.startsWith('trap:')) {
        const uci = r.blunder_id.split('|').pop()!;
        const res = await prepareFall({ fen: r.fen, played_move: uci, players: r.fell_count ?? 3 });
        puzzle = res.ok ? res.puzzle : null;
      } else {
        const row = fetchBlunder(r.blunder_id, target);
        puzzle = row ? buildPuzzle(row) : null;
      }
      if (!puzzle) {
        console.warn(`  ${r.scheduled_for}: cannot rebuild ${r.blunder_id}; left as is`);
        continue;
      }
      const out = await produce(puzzle, r.scheduled_for, work, localMedia, rc, recent);
      const set = Object.entries(producedColumns(puzzle, out))
        .map(([k, v]) => `${k} = ${sql(v)}`)
        .join(', ');
      d1(`UPDATE social_posts SET ${set} WHERE id = ${sql(r.id)}`, target);
      console.log(`  ${r.scheduled_for}: refreshed (${out.script.hookStyle}, ${out.source}, ${out.duration.toFixed(1)}s) → ${out.mediaUrl}`);
    }
  } finally {
    if (!localMedia) rmSync(work, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs();
  const target: Target = { remote: !!args.remote };
  const days = typeof args.days === 'string' ? Number(args.days) : 7;
  const localMedia = typeof args['local-media'] === 'string' ? args['local-media'] : null;
  if (args['refresh-queued']) await refreshQueued(target, localMedia);
  await fill(target, days, localMedia);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
