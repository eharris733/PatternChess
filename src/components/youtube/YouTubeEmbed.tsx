import { useMemo, useRef, type RefObject } from 'react';
import clsx from 'clsx';

/** The 11-character id from a YouTube watch / youtu.be URL, or null. */
export function youtubeIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get('v') ?? (u.hostname === 'youtu.be' ? u.pathname.slice(1) : null);
  } catch {
    return null;
  }
}

/** The watch URL (opens on YouTube, starting at `start` seconds when given). */
export function youtubeWatchUrl(videoId: string, start?: number): string {
  return `https://www.youtube.com/watch?v=${videoId}${start ? `&t=${Math.floor(start)}s` : ''}`;
}

export interface YouTubePlayer {
  ref: RefObject<HTMLIFrameElement>;
  /** Embed URL, or null with no video. */
  src: string | null;
  /** Jump to a moment and play (IFrame API postMessage commands). */
  seek: (seconds: number) => void;
}

/**
 * A creator's YouTube video, embedded (never re-hosted). `start`/`end` clip
 * the player to one segment. `seek` drives the IFrame API with postMessage
 * commands, so no YouTube script loads on our page.
 */
export function useYouTubePlayer(videoId: string | null, opts: { start?: number; end?: number } = {}): YouTubePlayer {
  const ref = useRef<HTMLIFrameElement>(null);
  const { start, end } = opts;
  const src = useMemo(() => {
    if (!videoId) return null;
    const params = new URLSearchParams({ enablejsapi: '1', rel: '0', playsinline: '1' });
    if (start) params.set('start', String(Math.floor(start)));
    if (end) params.set('end', String(Math.floor(end)));
    return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
  }, [videoId, start, end]);
  const seek = (seconds: number) => {
    const win = ref.current?.contentWindow;
    if (!win) return;
    const command = (func: string, args: unknown[] = []) =>
      win.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
    command('seekTo', [seconds, true]);
    command('playVideo');
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  return { ref, src, seek };
}

/**
 * The 16:9 player frame. The app is cross-origin isolated (COEP require-corp,
 * for multi-threaded Stockfish), which blocks third-party frames:
 * `credentialless` lets Chrome load YouTube anyway while the page stays
 * isolated. public/_headers also drops COEP on the public /c/* demos, which run
 * no engine, so other browsers play those too.
 */
export function YouTubeEmbed({
  player,
  title,
  className,
  testId,
}: {
  player: YouTubePlayer;
  title: string;
  className?: string;
  testId?: string;
}) {
  if (!player.src) return null;
  return (
    <div className={clsx('relative w-full aspect-video bg-text-primary', className)} data-testid={testId}>
      <iframe
        ref={player.ref}
        src={player.src}
        title={title}
        className="absolute inset-0 w-full h-full"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        {...{ credentialless: '' }}
      />
    </div>
  );
}
