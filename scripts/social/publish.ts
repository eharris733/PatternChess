// Hands today's queued videos (one per slot, series.ts) to Buffer, which
// publishes each at its slot time as an Instagram Reel, a public TikTok post
// and a YouTube Short. The channels are independent — one failing never blocks
// the others — and a rerun retries only the channels with no Buffer post yet. Each run also reads back the last 14 days of
// Buffer posts (sent / error, the Instagram link) and pulls Reel insights when
// an Instagram token is in KV.
//
//   node scripts/social/publish.ts [--remote] [--skip-insights] [--day YYYY-MM-DD]
//
// --day (draft / dry only) previews an upcoming day's video in Buffer.
//
// SOCIAL_MODE: live = schedule in Buffer; draft = Buffer drafts (nothing
// publishes, nothing is recorded, reruns make new drafts); anything else logs.
// Channels: BUFFER_INSTAGRAM_CHANNEL_ID / BUFFER_TIKTOK_CHANNEL_ID /
// BUFFER_YOUTUBE_CHANNEL_ID (unset = skip that channel); BUFFER_API_KEY.
import { createVideoPost, postState, type BufferChannel } from './buffer.ts';
import { d1, sql, type Target } from './cloudflare.ts';
import { env, parseArgs, socialMode } from './env.ts';
import { mediaIdForPermalink, reelInsights, refreshIgTokenIfStale } from './instagram.ts';
import { addDays, utcToday } from './plan.ts';
import { dueAtFor } from './series.ts';

interface PostRow {
  id: string;
  slot: number;
  status: string;
  caption: string;
  tiktok_caption: string | null;
  youtube_title: string | null;
  youtube_caption: string | null;
  media_url: string;
  buffer_ig_post_id: string | null;
  buffer_tiktok_post_id: string | null;
  buffer_yt_post_id: string | null;
}

type PostColumn = 'buffer_ig_post_id' | 'buffer_tiktok_post_id' | 'buffer_yt_post_id';

function update(id: string, fields: Record<string, string | number | null>, target: Target): void {
  const set = Object.entries(fields)
    .map(([k, v]) => `${k} = ${sql(v)}`)
    .join(', ');
  d1(`UPDATE social_posts SET ${set} WHERE id = ${sql(id)}`, target);
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

const CHANNELS: { channel: BufferChannel; idVar: string; column: PostColumn }[] = [
  { channel: 'instagram', idVar: 'BUFFER_INSTAGRAM_CHANNEL_ID', column: 'buffer_ig_post_id' },
  { channel: 'tiktok', idVar: 'BUFFER_TIKTOK_CHANNEL_ID', column: 'buffer_tiktok_post_id' },
  { channel: 'youtube', idVar: 'BUFFER_YOUTUBE_CHANNEL_ID', column: 'buffer_yt_post_id' },
];

/** The post text and title per channel (pure). */
export function channelPost(row: Pick<PostRow, 'caption' | 'tiktok_caption' | 'youtube_title' | 'youtube_caption'>, channel: BufferChannel): { text: string; title?: string } {
  if (channel === 'tiktok') return { text: row.tiktok_caption ?? row.caption };
  if (channel === 'youtube') return { text: row.youtube_caption ?? row.tiktok_caption ?? row.caption, title: row.youtube_title ?? undefined };
  return { text: row.caption };
}

/** The status column Buffer's state is mirrored into, per channel. */
const STATUS_COLUMN: Partial<Record<BufferChannel, string>> = { tiktok: 'tiktok_status', youtube: 'yt_status' };

/**
 * Which day to hand to Buffer: today, or (draft / dry only) the day given with
 * --day, to preview an upcoming video in Buffer. A live run never posts
 * another day's video.
 */
export function publishDay(mode: 'live' | 'draft' | 'dry', requested: string | null, today = utcToday()): string {
  if (!requested || requested === today) return today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requested)) throw new Error(`--day must be YYYY-MM-DD, got ${requested}`);
  if (mode === 'live') throw new Error('--day is for SOCIAL_MODE=draft or dry; live only posts today');
  return requested;
}

async function publishToday(target: Target, mode: 'live' | 'draft' | 'dry', requestedDay: string | null): Promise<void> {
  const today = publishDay(mode, requestedDay);
  const rows = d1<PostRow>(
    `SELECT id, slot, status, caption, tiktok_caption, youtube_title, youtube_caption, media_url,
            buffer_ig_post_id, buffer_tiktok_post_id, buffer_yt_post_id FROM social_posts
     WHERE scheduled_for = ${sql(today)} AND status IN ('queued', 'posted', 'failed') ORDER BY slot`,
    target,
  );
  if (!rows.length) {
    console.log(`${today}: nothing queued (vetoed or the queue ran dry)`);
    return;
  }
  for (const row of rows) await publishRow(row, today, target, mode);
}

async function publishRow(row: PostRow, day: string, target: Target, mode: 'live' | 'draft' | 'dry'): Promise<void> {
  const label = `${day} slot ${row.slot}`;
  const todo = CHANNELS.filter((c) => env(c.idVar) && !row[c.column] && (c.channel !== 'youtube' || row.youtube_title));
  if (todo.length === 0) {
    console.log(`${label}: already handed to Buffer (or no channel configured)`);
    return;
  }
  // A draft / preview of another day publishes nowhere: due soon is fine.
  const dueAt = mode === 'live' ? dueAtFor(day, row.slot) : dueAtFor(utcToday(), row.slot);
  if (mode === 'dry') {
    console.log(`[dry] ${label}: would schedule ${row.media_url} on ${todo.map((c) => c.channel).join(' + ')} at ${dueAt}`);
    console.log(`[dry]   Instagram caption:\n${row.caption}`);
    return;
  }

  const errors: string[] = [];
  let scheduled = 0;
  for (const c of todo) {
    try {
      const post = await createVideoPost({
        channel: c.channel,
        channelId: env(c.idVar)!,
        ...channelPost(row, c.channel),
        videoUrl: row.media_url,
        dueAt,
        draft: mode === 'draft',
      });
      console.log(`${label} ${c.channel}: Buffer ${mode === 'draft' ? 'draft' : 'post'} ${post.id} (${post.status}, due ${dueAt})`);
      if (mode === 'live') {
        const statusCol = STATUS_COLUMN[c.channel];
        update(row.id, { [c.column]: post.id, ...(statusCol ? { [statusCol]: post.status } : {}) }, target);
        scheduled++;
      }
    } catch (e) {
      errors.push(`${c.channel}: ${errText(e)}`);
      console.error(`${label} ${c.channel} failed: ${errText(e)}`);
    }
  }
  if (mode === 'live') {
    const handedOff = scheduled > 0 || CHANNELS.some((c) => row[c.column]);
    update(row.id, { status: handedOff ? 'posted' : 'failed', buffer_error: errors.length ? errors.join(' | ') : null }, target);
  }
  if (errors.length) process.exitCode = 1; // a red run in Actions; a rerun retries the failed channel
}

/** Reads back what Buffer did with the last 14 days of posts. */
async function syncBuffer(target: Target): Promise<void> {
  const rows = d1<{ id: string; buffer_ig_post_id: string | null; buffer_tiktok_post_id: string | null; buffer_yt_post_id: string | null; permalink: string | null }>(
    `SELECT id, buffer_ig_post_id, buffer_tiktok_post_id, buffer_yt_post_id, permalink FROM social_posts
     WHERE (buffer_ig_post_id IS NOT NULL OR buffer_tiktok_post_id IS NOT NULL OR buffer_yt_post_id IS NOT NULL)
       AND scheduled_for >= ${sql(addDays(utcToday(), -14))}`,
    target,
  );
  for (const r of rows) {
    const errors: string[] = [];
    const fields: Record<string, string | number | null> = {};
    let anySent = false;
    let allFailed = true;
    for (const [channel, id] of [['instagram', r.buffer_ig_post_id], ['tiktok', r.buffer_tiktok_post_id], ['youtube', r.buffer_yt_post_id]] as const) {
      if (!id) continue;
      try {
        const s = await postState(id);
        if (s.status !== 'error') allFailed = false;
        if (s.status === 'sent') anySent = true;
        if (s.error) errors.push(`${channel}: ${s.error}`);
        const statusCol = STATUS_COLUMN[channel];
        if (statusCol) fields[statusCol] = s.status;
        if (channel === 'instagram' && s.externalLink && s.externalLink !== r.permalink) fields.permalink = s.externalLink;
        if (s.sentAt && channel === 'instagram') fields.posted_at = s.sentAt;
      } catch (e) {
        allFailed = false; // unknown: don't mark the row failed on a read error
        console.warn(`buffer ${channel} ${id}: ${errText(e)}`);
      }
    }
    fields.buffer_error = errors.length ? errors.join(' | ') : null;
    if (allFailed) fields.status = 'failed';
    else if (anySent) fields.status = 'posted';
    update(r.id, fields, target);
  }
  if (rows.length) console.log(`buffer: synced ${rows.length} post(s)`);
}

async function pullInsights(target: Target): Promise<void> {
  const rows = d1<{ id: string; ig_media_id: string | null; permalink: string | null }>(
    `SELECT id, ig_media_id, permalink FROM social_posts
     WHERE (ig_media_id IS NOT NULL OR permalink IS NOT NULL) AND scheduled_for >= ${sql(addDays(utcToday(), -14))}`,
    target,
  );
  for (const r of rows) {
    try {
      let mediaId = r.ig_media_id;
      if (!mediaId && r.permalink) {
        mediaId = await mediaIdForPermalink(r.permalink);
        if (mediaId) update(r.id, { ig_media_id: mediaId }, target);
      }
      if (!mediaId) continue;
      const i = await reelInsights(mediaId);
      update(
        r.id,
        { plays: i.views, reach: i.reach, likes: i.likes, comments: i.comments, saves: i.saved, shares: i.shares, insights_at: new Date().toISOString() },
        target,
      );
    } catch (e) {
      console.warn(`insights ${r.id}: ${errText(e)}`);
    }
  }
  if (rows.length) console.log(`insights: ${rows.length} Reel(s)`);
}

async function main() {
  const args = parseArgs();
  const target: Target = { remote: !!args.remote };
  const mode = socialMode();
  await publishToday(target, mode, typeof args.day === 'string' && args.day.trim() ? args.day.trim() : null);
  if (mode !== 'live') return;
  await syncBuffer(target);
  if (args['skip-insights']) return;
  try {
    await pullInsights(target);
    if (await refreshIgTokenIfStale()) console.log('Instagram token refreshed');
  } catch (e) {
    // Insights are optional: no Instagram token in KV just means no stats on /analytics.
    console.warn(`insights skipped: ${errText(e)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
