import { useState } from 'react';
import clsx from 'clsx';
import { useSetSocialStatus, useSocialQueue, type SocialPost, type SocialScript } from '../../hooks/useSocialQueue';

const ACTION_BASE =
  'font-mono uppercase text-[10px] tracking-tight px-2 py-1 border-2 rounded-none transition-colors disabled:opacity-50';
const ACTION_CLASS = `${ACTION_BASE} border-text-primary/30 text-text-primary hover:border-text-primary`;

function dayLabel(day: string, today: string): string {
  if (day === today) return 'Today';
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={ACTION_CLASS}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

/** Poster until clicked, then the video. Media is cross-origin (R2), so both need CORS under COEP. */
function Preview({ post }: { post: SocialPost }) {
  const [playing, setPlaying] = useState(false);
  if (!post.media_url) return null;
  return (
    <div className="w-[108px] shrink-0 aspect-[9/16] bg-surface-2 border-2 border-text-primary/20 overflow-hidden">
      {playing ? (
        <video
          src={post.media_url}
          crossOrigin="anonymous"
          controls
          autoPlay
          playsInline
          preload="none"
          className="w-full h-full object-cover"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          className="w-full h-full"
          aria-label={`Play the video for ${post.scheduled_for}`}
        >
          {post.poster_url && (
            <img src={post.poster_url} crossOrigin="anonymous" alt="" className="w-full h-full object-cover" />
          )}
        </button>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  return (
    <span>
      <span className="font-mono">{value.toLocaleString()}</span> {label}
    </span>
  );
}

const SLOT_LABEL: Record<number, string> = { 0: 'Puzzle · ~12:10 ET', 1: 'Blunders decide games · ~18:30 ET' };

const BEAT_LABEL: Record<keyof SocialScript['beats'], string> = {
  hook: 'Hook',
  challenge: 'Challenge',
  played: 'Played',
  refutation: 'Punishment',
  reveal: 'Reveal',
  cta: 'Close',
};

/** The narrated script, folded: what the voice says in each scene. */
function ScriptDetails({ post, script }: { post: SocialPost; script: SocialScript }) {
  return (
    <details className="text-xs" data-testid="social-post-script">
      <summary className="cursor-pointer">
        Voiceover: <span className="font-semibold">{script.headline}</span> ({post.script_source === 'claude' ? 'written by Claude' : 'template'}
        {post.voice && <>, voice {post.voice}</>})
      </summary>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        {(Object.keys(BEAT_LABEL) as (keyof SocialScript['beats'])[]).map((b) =>
          script.beats[b] ? (
            <div key={b} className="contents">
              <dt className="font-semibold">{BEAT_LABEL[b]}</dt>
              <dd>{script.beats[b]}</dd>
            </div>
          ) : null,
        )}
      </dl>
    </details>
  );
}

function PostRow({ post, today }: { post: SocialPost; today: string }) {
  const setStatus = useSetSocialStatus();
  const vetoed = post.status === 'vetoed';
  const upcoming = post.status === 'queued' || vetoed;
  const p = post.puzzle;
  return (
    <div
      className={clsx('flex gap-3 py-3 first:pt-0 border-t first:border-t-0 border-text-primary/10', vetoed && 'opacity-50')}
      data-testid="social-post"
    >
      <Preview post={post} />
      <div className="flex flex-col gap-1.5 min-w-0 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-semibold">{dayLabel(post.scheduled_for, today)}</span>
          <span className="font-mono text-xs">{SLOT_LABEL[post.slot ?? 0]}</span>
          <span className="text-text-secondary text-xs">
            {vetoed ? 'Vetoed: will not post' : post.status === 'failed' ? 'Failed' : post.status === 'posted' ? 'Posted' : 'Queued'}
          </span>
        </div>
        {p && post.format === 'pro' && p.pro ? (
          <p className="text-xs" data-testid="social-post-puzzle">
            Blunders decide games · {p.pro.white.title} {p.pro.white.name} vs {p.pro.black.title} {p.pro.black.name}, {p.pro.event} {p.pro.year} ·{' '}
            blunder <span className="font-mono">{p.played}</span> · punishment <span className="font-mono">{p.solution.join(' ')}</span> ·{' '}
            <a href={p.pro.url} target="_blank" rel="noreferrer" className="underline">
              game
            </a>
          </p>
        ) : p && post.format === 'fall' ? (
          <p className="text-xs" data-testid="social-post-puzzle">
            Would you fall for this · {post.fell_count ?? p.fellCount} players played <span className="font-mono">{p.played}</span> ·
            punished by <span className="font-mono">{(p.refutation ?? []).join(' ')}</span> · right move{' '}
            <span className="font-mono">{p.solution.join(' ')}</span>
          </p>
        ) : (
          p && (
            <p className="text-xs" data-testid="social-post-puzzle">
              Blunder of the day · {p.side === 'white' ? 'White' : 'Black'} to move · played <span className="font-mono">{p.played}</span> · answer{' '}
              <span className="font-mono">{p.solution.join(' ')}</span>
              {p.motifLabel && <> · {p.motifLabel}</>}
            </p>
          )
        )}
        {post.script && <ScriptDetails post={post} script={post.script} />}
        {post.caption && <p className="text-xs whitespace-pre-line line-clamp-3">{post.caption}</p>}
        {post.status === 'posted' && (
          <p className="text-xs flex flex-wrap gap-x-3">
            <Stat label="views" value={post.plays} />
            <Stat label="reach" value={post.reach} />
            <Stat label="likes" value={post.likes} />
            <Stat label="comments" value={post.comments} />
            <Stat label="saves" value={post.saves} />
            <Stat label="shares" value={post.shares} />
            {post.hook_template && <span className="text-text-secondary">hook {post.hook_template}</span>}
          </p>
        )}
        {(post.buffer_ig_post_id || post.buffer_tiktok_post_id || post.buffer_yt_post_id) && (
          <p className="text-xs" data-testid="social-post-buffer">
            Buffer: {post.buffer_ig_post_id ? 'Instagram scheduled' : 'Instagram not sent'} ·{' '}
            {post.buffer_tiktok_post_id ? `TikTok ${post.tiktok_status ?? 'scheduled'}` : 'TikTok not sent'} ·{' '}
            {post.buffer_yt_post_id ? `YouTube ${post.yt_status ?? 'scheduled'}` : 'YouTube not sent'}
          </p>
        )}
        {(post.ig_error || post.tiktok_error || post.buffer_error) && (
          <p className="text-xs text-incorrect">
            {post.buffer_error && <>{post.buffer_error} </>}
            {post.ig_error && <>Instagram: {post.ig_error} </>}
            {post.tiktok_error && <>TikTok: {post.tiktok_error}</>}
          </p>
        )}
        {post.tiktok_status === 'SEND_TO_USER_INBOX' && (
          <p className="text-xs">TikTok draft is in your inbox: open TikTok and post it.</p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {upcoming && (
            <button
              type="button"
              className={ACTION_CLASS}
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate({ id: post.id, status: vetoed ? 'queued' : 'vetoed' })}
            >
              {vetoed ? 'Restore' : 'Veto'}
            </button>
          )}
          {post.tiktok_caption && <CopyButton text={post.tiktok_caption} label="Copy TikTok caption" />}
          {post.youtube_title && <CopyButton text={post.youtube_title} label="Copy YouTube title" />}
          {post.media_url && (
            <a href={post.media_url} download className={ACTION_CLASS}>
              Download MP4
            </a>
          )}
          {post.permalink && (
            <a href={post.permalink} target="_blank" rel="noreferrer" className={ACTION_CLASS}>
              Instagram
            </a>
          )}
        </div>
        {setStatus.error && <p className="text-xs text-incorrect">{setStatus.error.message}</p>}
      </div>
    </div>
  );
}

/** The social videos (scripts/social/): two slots a day, what's queued for the week, veto / restore, how posts did. Admin-only. */
export function SocialQueueCard() {
  const { data } = useSocialQueue();
  if (!data || !Array.isArray(data.upcoming) || !Array.isArray(data.recent)) return null;
  return (
    <section className="card flex flex-col gap-3" data-testid="social-queue-card">
      <header className="flex items-baseline justify-between gap-3">
        <span className="label">Social videos</span>
        <span className="text-xs">Instagram, TikTok and YouTube Shorts via Buffer · 17:10 and 23:30 UTC unless vetoed</span>
      </header>
      {data.upcoming.length === 0 ? (
        <p className="text-sm">Nothing queued. The next run of the social workflow fills the coming week.</p>
      ) : (
        <div className="flex flex-col">
          {data.upcoming.map((p) => (
            <PostRow key={p.id} post={p} today={data.today} />
          ))}
        </div>
      )}
      {data.recent.length > 0 && (
        <>
          <span className="label pt-2">Last 14 days</span>
          <div className="flex flex-col">
            {data.recent.map((p) => (
              <PostRow key={p.id} post={p} today={data.today} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
