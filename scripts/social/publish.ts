// Posts today's queued video: an Instagram Reel (published) and a TikTok inbox
// draft (you tap Post in the app). The channels are independent — one failing
// never blocks the other — and a rerun retries only what didn't go out. Then
// pulls Reel insights for the last 14 days and refreshes the Instagram token.
//
//   node scripts/social/publish.ts [--remote] [--skip-insights]
//
// SOCIAL_MODE=live is required to post; anything else logs what it would do.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { d1, sql, type Target } from './cloudflare.ts';
import { parseArgs, socialMode } from './env.ts';
import { publishReel, reelInsights, refreshIgTokenIfStale } from './instagram.ts';
import { addDays, utcToday } from './plan.ts';
import { sendToInbox, tiktokAccessToken, tiktokConfigured } from './tiktok.ts';

interface PostRow {
  id: string;
  status: string;
  caption: string;
  media_url: string;
  ig_media_id: string | null;
  tiktok_status: string | null;
}

const TIKTOK_DONE = new Set(['SEND_TO_USER_INBOX', 'PUBLISH_COMPLETE']);

function update(id: string, fields: Record<string, string | number | null>, target: Target): void {
  const set = Object.entries(fields)
    .map(([k, v]) => `${k} = ${sql(v)}`)
    .join(', ');
  d1(`UPDATE social_posts SET ${set} WHERE id = ${sql(id)}`, target);
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

async function downloadTo(url: string, dir: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url}: HTTP ${res.status}`);
  const file = join(dir, 'video.mp4');
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

async function publishToday(target: Target, live: boolean): Promise<void> {
  const today = utcToday();
  const rows = d1<PostRow>(
    `SELECT id, status, caption, media_url, ig_media_id, tiktok_status FROM social_posts
     WHERE scheduled_for = ${sql(today)} AND status IN ('queued', 'posted', 'failed')`,
    target,
  );
  const row = rows[0];
  if (!row) {
    console.log(`${today}: nothing queued (vetoed or the queue ran dry)`);
    return;
  }
  const needIg = !row.ig_media_id;
  const needTikTok = tiktokConfigured() && !TIKTOK_DONE.has(row.tiktok_status ?? '');
  if (!needIg && !needTikTok) {
    console.log(`${today}: already out`);
    return;
  }
  if (!live) {
    console.log(`[dry] ${today}: would post ${row.media_url}`);
    if (needIg) console.log(`[dry]   Instagram Reel, caption:\n${row.caption}`);
    if (needTikTok) console.log('[dry]   TikTok inbox draft');
    return;
  }

  let igOk = !needIg;
  let ttOk = !needTikTok;
  if (needIg) {
    try {
      const media = await publishReel({ videoUrl: row.media_url, caption: row.caption });
      update(row.id, { ig_media_id: media.id, permalink: media.permalink, ig_error: null, posted_at: new Date().toISOString() }, target);
      console.log(`Instagram: ${media.permalink ?? media.id}`);
      igOk = true;
    } catch (e) {
      update(row.id, { ig_error: errText(e) }, target);
      console.error(`Instagram failed: ${errText(e)}`);
    }
  }
  if (needTikTok) {
    const dir = mkdtempSync(join(tmpdir(), 'pc-tt-'));
    try {
      const res = await sendToInbox(await downloadTo(row.media_url, dir));
      update(row.id, { tiktok_publish_id: res.publishId, tiktok_status: res.status, tiktok_error: null }, target);
      console.log(`TikTok: ${res.status}`);
      ttOk = TIKTOK_DONE.has(res.status);
    } catch (e) {
      update(row.id, { tiktok_status: 'FAILED', tiktok_error: errText(e) }, target);
      console.error(`TikTok failed: ${errText(e)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  update(row.id, { status: igOk || ttOk ? 'posted' : 'failed' }, target);
  if (!igOk || !ttOk) process.exitCode = 1; // a red run in Actions; a rerun retries the failed channel
}

async function pullInsights(target: Target): Promise<void> {
  const rows = d1<{ id: string; ig_media_id: string }>(
    `SELECT id, ig_media_id FROM social_posts
     WHERE ig_media_id IS NOT NULL AND scheduled_for >= ${sql(addDays(utcToday(), -14))}`,
    target,
  );
  for (const r of rows) {
    try {
      const i = await reelInsights(r.ig_media_id);
      update(
        r.id,
        { plays: i.views, reach: i.reach, likes: i.likes, comments: i.comments, saves: i.saved, shares: i.shares, insights_at: new Date().toISOString() },
        target,
      );
    } catch (e) {
      console.warn(`insights ${r.ig_media_id}: ${errText(e)}`);
    }
  }
  if (rows.length) console.log(`insights: ${rows.length} Reel(s)`);
}

async function main() {
  const args = parseArgs();
  const target: Target = { remote: !!args.remote };
  const live = socialMode() === 'live';
  await publishToday(target, live);
  if (!live) return;
  if (!args['skip-insights']) await pullInsights(target);
  if (await refreshIgTokenIfStale()) console.log('Instagram token refreshed');
  // Exercise the TikTok refresh on quiet days too, so the rotating pair never lapses.
  if (tiktokConfigured()) await tiktokAccessToken();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
