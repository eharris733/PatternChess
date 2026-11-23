// Tops up the review queue: every day from tomorrow to today+N without a live
// (queued / posted) row gets the next verified puzzle, rendered and uploaded.
// Today's slot is never filled here — a day you vetoed stays empty instead of
// getting a puzzle nobody reviewed.
//
//   node scripts/social/plan.ts [--remote] [--days 7] [--local-media <dir>]
//
// --local-media renders into <dir> and stores file:// URLs instead of
// uploading to R2 (local dry runs against the local D1).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { d1, r2Put, sql, type Target } from './cloudflare.ts';
import { instagramCaption, tiktokCaption, hookForDay } from './copy.ts';
import { verifyPuzzle } from './engine.ts';
import { parseArgs } from './env.ts';
import { buildPuzzle, pickMotif, type Puzzle } from './puzzle.ts';
import { makeRenderContext, renderPuzzle } from './render.ts';
import { fetchCandidates, nextCandidate, ownerId } from './select.ts';

const DAY_MS = 86400_000;
/** Engine checks per run (each ~4s); rejects are remembered, so later runs dig deeper. */
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

/** What the review card shows (and what was drawn). */
export function puzzleSummary(p: Puzzle, hookId: string) {
  return {
    fen: p.fen,
    side: p.side,
    rating: p.rating,
    timeControl: p.timeControl,
    played: p.played.san,
    solution: p.solution.map((s) => s.san),
    motifLabel: p.motifLabel,
    hook: hookId,
  };
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

async function main() {
  const args = parseArgs();
  const target: Target = { remote: !!args.remote };
  const days = typeof args.days === 'string' ? Number(args.days) : 7;
  const localMedia = typeof args['local-media'] === 'string' ? args['local-media'] : null;
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
  const pool = fetchCandidates(owner, target);
  console.log(`${slots.length} empty day(s); ${pool.length} candidate(s)`);
  const rc = await makeRenderContext();
  const work = localMedia ?? mkdtempSync(join(tmpdir(), 'pc-social-'));
  let checks = 0;

  try {
    for (const day of slots) {
      let filled = false;
      while (!filled && checks < MAX_CHECKS) {
        const row = nextCandidate(pool, motifByDay.get(addDays(day, -1)) ?? null);
        if (!row) break;
        const puzzle = buildPuzzle(row);
        if (!puzzle) continue;
        checks++;
        const verdict = await verifyPuzzle(row.fen, puzzle.solution[0].uci);
        if (!verdict.ok) {
          console.log(`  reject ${row.id}: ${verdict.reason}`);
          d1(
            `INSERT INTO social_posts (id, blunder_id, fen, status, reject_reason, created_at)
             VALUES (${sql(crypto.randomUUID())}, ${sql(row.id)}, ${sql(row.fen)}, 'rejected', ${sql(verdict.reason)}, ${sql(new Date().toISOString())})`,
            target,
          );
          continue;
        }

        const hook = hookForDay(day);
        const res = await renderPuzzle(puzzle, hook, work, rc);
        const base = `reels/${day}-${shortId()}`;
        const mediaUrl = localMedia ? `file://${res.mp4}` : r2Put(res.mp4, `${base}.mp4`, 'video/mp4');
        const posterUrl = localMedia ? `file://${res.poster}` : r2Put(res.poster, `${base}.jpg`, 'image/jpeg');
        const motif = pickMotif(row.motifs);
        d1(
          `INSERT INTO social_posts (id, blunder_id, fen, scheduled_for, status, hook_template, motif, caption,
             tiktok_caption, puzzle, media_url, poster_url, created_at)
           VALUES (${[
             crypto.randomUUID(),
             row.id,
             row.fen,
             day,
             'queued',
             hook.id,
             motif,
             instagramCaption(puzzle, hook),
             tiktokCaption(puzzle, hook),
             JSON.stringify(puzzleSummary(puzzle, hook.id)),
             mediaUrl,
             posterUrl,
             new Date().toISOString(),
           ]
             .map(sql)
             .join(', ')})`,
          target,
        );
        motifByDay.set(day, motif);
        console.log(`  ${day}: ${row.id} (${puzzle.motifLabel ?? 'no motif'}, ${hook.id}) → ${mediaUrl}`);
        filled = true;
      }
      if (!filled) {
        console.warn(`  ${day}: no verified puzzle (checked ${checks}, ${pool.length} left) — next run tries again`);
        break;
      }
    }
  } finally {
    if (!localMedia) rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
