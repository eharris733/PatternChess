import { useState } from 'react';
import clsx from 'clsx';
import { useSetSocialStatus, useSocialQueue, type SocialPost } from '../../hooks/useSocialQueue';

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
          <span className="text-text-secondary text-xs">
            {vetoed ? 'Vetoed: will not post' : post.status === 'failed' ? 'Failed' : post.status === 'posted' ? 'Posted' : 'Queued'}
          </span>
        </div>
        {p && (
          <p className="text-xs">
            {p.side === 'white' ? 'White' : 'Black'} to move · played <span className="font-mono">{p.played}</span> · answer{' '}
            <span className="font-mono">{p.solution.join(' ')}</span>
            {p.motifLabel && <> · {p.motifLabel}</>}
          </p>
        )}
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
        {(post.ig_error || post.tiktok_error) && (
          <p className="text-xs text-incorrect">
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

/** The daily puzzle video (scripts/social/): what's queued for the week, veto / restore, how posts did. Admin-only. */
export function SocialQueueCard() {
  const { data } = useSocialQueue();
  if (!data || !Array.isArray(data.upcoming) || !Array.isArray(data.recent)) return null;
  return (
    <section className="card flex flex-col gap-3" data-testid="social-queue-card">
      <header className="flex items-baseline justify-between gap-3">
        <span className="label">Daily puzzle video</span>
        <span className="text-text-secondary text-xs">Instagram Reel + TikTok draft · posts daily ~17:00 UTC unless vetoed</span>
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
