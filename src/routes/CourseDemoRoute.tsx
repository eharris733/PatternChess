import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { BoardPanel } from '../components/BoardPanel';
import { BrandLockup } from '../components/BrandLogo';
import { Skeleton } from '../components/Skeleton';
import { parseUciMove } from '../chess/moveUtils';
import type { LearnNode, LearnStudy } from '../models/learn';
import { countMoments, drillFen, useLearnDrillStore } from '../state/learnDrillStore';
import { useForceDefaultTheme } from '../state/themeStore';
import { useHead } from '../seo/useHead';

/**
 * Unlisted interactive course built from a creator's video (/c/<slug>). Public
 * and logged-out: it's the link in a creator pitch, so nothing here may need an
 * account. Courses live in src/generated/courses/ (never the /learn index) and
 * the page is noindex — the slug carries a random suffix so it isn't guessable.
 */

const CONTACT_EMAIL = 'elliot@patternchess.com';

const loaders = import.meta.glob<{ default: LearnStudy }>('../generated/courses/*.json');

async function loadCourse(slug: string): Promise<LearnStudy | null> {
  const load = loaders[`../generated/courses/${slug}.json`];
  if (!load) return null;
  const mod = await load();
  return (mod.default ?? mod) as LearnStudy;
}

function lastMoveOf(node: LearnNode | undefined): [string, string] | null {
  if (!node) return null;
  const m = parseUciMove(node.uci);
  return [m.from, m.to];
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}:${String(seconds % 60).padStart(2, '0')}`;
}

function youtubeId(url: string): string | null {
  const u = new URL(url);
  return u.searchParams.get('v') ?? (u.hostname === 'youtu.be' ? u.pathname.slice(1) : null);
}

/**
 * The creator's own video, embedded (never re-hosted) so the learner can watch
 * along. `seek` jumps the player to a moment via the IFrame API's postMessage
 * commands. The site is cross-origin isolated (COEP require-corp, for
 * Stockfish), which blocks third-party frames: `credentialless` lets Chrome load
 * it anyway, and public/_headers drops COEP on /c/* for other browsers.
 */
function useVideoPlayer(videoId: string | null, startAt: number) {
  const ref = useRef<HTMLIFrameElement>(null);
  const src = useMemo(
    () =>
      videoId
        ? `https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1&rel=0&playsinline=1&start=${startAt}`
        : null,
    // The start position only matters for the first load; seek handles the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [videoId],
  );
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

export function CourseDemoRoute() {
  useForceDefaultTheme();
  useHead({
    title: 'Interactive course preview',
    description: 'A private preview of an interactive chess course.',
    canonical: '/c',
    robots: 'noindex,nofollow',
  });
  const { slug = '' } = useParams();
  const query = useQuery({
    queryKey: ['course', slug],
    queryFn: () => loadCourse(slug),
    staleTime: Infinity,
  });

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <header className="p-4 border-b-2 border-text-primary/20">
        <Link to="/" className="inline-flex">
          <BrandLockup size="sm" />
        </Link>
      </header>
      <main className="flex-1 p-4 md:p-6 w-full max-w-6xl mx-auto">
        {query.isPending ? (
          <Skeleton className="h-[32rem] w-full" />
        ) : !query.data ? (
          <div
            className="card w-full max-w-md mx-auto flex flex-col gap-3 text-center"
            data-testid="course-not-found"
          >
            <h1 className="heading-md">This course link doesn't work</h1>
            <p className="text-text-secondary text-sm">
              Check that the whole link was copied, or ask the person who sent it for a fresh one.
            </p>
          </div>
        ) : (
          <CoursePlayer course={query.data} />
        )}
      </main>
    </div>
  );
}

function CoursePlayer({ course }: { course: LearnStudy }) {
  const chapters = course.chapterData;
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const chapter = chapters[index];
  const drill = useLearnDrillStore();

  useEffect(() => {
    useLearnDrillStore.getState().start(chapter);
    return () => useLearnDrillStore.getState().reset();
  }, [chapter]);

  // Space / Enter continues past an explanation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === ' ' || e.key === 'Enter') && useLearnDrillStore.getState().phase === 'explain') {
        e.preventDefault();
        useLearnDrillStore.getState().next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const perChapter = useMemo(() => chapters.map(countMoments), [chapters]);
  const total = perChapter.reduce((a, b) => a + b, 0);
  const before = perChapter.slice(0, index).reduce((a, b) => a + b, 0);
  const done = finished
    ? total
    : before + Math.min(perChapter[index] ?? 0, drill.chapter?.id === chapter.id ? drill.momentsDone : 0);
  const source = course.source;
  const side = chapter.orientation === 'white' ? 'White' : 'Black';
  const isLast = index + 1 >= chapters.length;
  const video = useVideoPlayer(source ? youtubeId(source.url) : null, chapters[0]?.introTs ?? 0);

  const status =
    drill.phase === 'done'
      ? 'Chapter complete.'
      : drill.phase === 'opponent'
        ? 'Opponent is replying…'
        : drill.phase === 'explain'
          ? null
          : `Your move as ${side}.`;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <span className="label">Interactive course preview</span>
        <h1 className="heading-lg">{course.title}</h1>
        {source && (
          <p className="text-text-primary text-sm" data-testid="course-credit">
            From{' '}
            <a href={source.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              {source.title}
            </a>{' '}
            by{' '}
            <a
              href={source.channelUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              {source.channel}
            </a>
          </p>
        )}
        <div className="flex items-center gap-3" data-testid="course-progress">
          <div className="flex-1 h-2 bg-surface border border-text-primary/30" aria-hidden>
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${(done / Math.max(1, total)) * 100}%` }}
            />
          </div>
          <span className="text-sm font-mono text-text-primary whitespace-nowrap">
            Moment {Math.min(total, done + (finished ? 0 : 1))} of {total}
          </span>
        </div>
      </header>

      {finished ? (
        <CourseComplete course={course} onRestart={() => (setFinished(false), setIndex(0))} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4">
          {/* Keep the whole board above the fold: header + progress take ~230px. */}
          <div className="w-full mx-auto" style={{ maxWidth: 'max(320px, calc(100vh - 240px))' }}>
            <BoardPanel
              fen={drillFen(drill) || chapter.startFen}
              orientation={chapter.orientation}
              movableFor={drill.phase === 'yourMove' ? chapter.orientation : null}
              lastMove={lastMoveOf(drill.path.at(-1))}
              shapes={drill.shapes}
              onMove={(m) => drill.play(`${m.from}${m.to}${m.promotion ?? ''}`)}
            />
          </div>
          <div className="flex flex-col gap-3 min-w-0">
            <div className="card !p-4 flex flex-col gap-1">
              <span className="label">
                Chapter {index + 1} of {chapters.length}
              </span>
              <h2 className="text-base font-semibold text-text-primary">{chapter.name}</h2>
            </div>
            <div className="card !p-4 flex flex-col gap-3" data-testid="course-coach">
              {status && (
                <p
                  className={clsx(
                    'text-sm font-semibold',
                    drill.phase === 'done' ? 'text-correct' : 'text-text-primary',
                  )}
                  data-testid="course-status"
                >
                  {status}
                </p>
              )}
              {drill.message && (
                <p className="text-sm text-text-primary leading-relaxed" data-testid="course-message">
                  {drill.message}
                </p>
              )}
              {video.src && drill.messageTs != null && drill.message && (
                <button
                  type="button"
                  onClick={() => video.seek(drill.messageTs!)}
                  className="text-xs font-mono uppercase tracking-tight underline underline-offset-2 self-start"
                  data-testid="course-watch"
                >
                  Watch this moment ({clock(drill.messageTs)})
                </button>
              )}
              {drill.phase === 'explain' && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={drill.next}
                  data-testid="course-continue"
                >
                  Continue
                </button>
              )}
              {drill.phase === 'done' && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => (isLast ? setFinished(true) : setIndex(index + 1))}
                  data-testid="course-next"
                >
                  {isLast ? 'Finish' : 'Next chapter'}
                </button>
              )}
            </div>
            <button type="button" className="pill self-start" onClick={() => drill.start(chapter)}>
              Restart chapter
            </button>
            {video.src && source && (
              <div className="card !p-3 flex flex-col gap-2" data-testid="course-video">
                <span className="label">Watch along</span>
                <div className="relative w-full aspect-video bg-text-primary">
                  <iframe
                    ref={video.ref}
                    src={video.src}
                    title={source.title}
                    className="absolute inset-0 w-full h-full"
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                    {...{ credentialless: '' }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CourseComplete({ course, onRestart }: { course: LearnStudy; onRestart: () => void }) {
  const source = course.source;
  const subject = encodeURIComponent(`PatternChess course: ${course.title}`);
  return (
    <div className="card w-full max-w-xl mx-auto flex flex-col gap-4" data-testid="course-complete">
      <span className="label">Course complete</span>
      <h2 className="heading-md">You've worked through every moment of the video.</h2>
      <p className="text-sm text-text-primary leading-relaxed">
        {source ? `${source.channel}${source.channel.endsWith('s') ? "'" : "'s"} video` : 'This lesson'} became a course you play instead of watch.
        Every quiz move comes from the video, wrong moves get the creator's own explanation, and every line
        was checked by Stockfish.
      </p>
      <p className="text-sm text-text-primary leading-relaxed">
        Built from your video by PatternChess. Want this for your channel?
      </p>
      <div className="flex flex-wrap gap-2">
        <a
          href={`mailto:${CONTACT_EMAIL}?subject=${subject}`}
          className="btn-primary"
          data-testid="course-contact"
        >
          Talk to us
        </a>
        <button type="button" className="pill" onClick={onRestart}>
          Play it again
        </button>
      </div>
    </div>
  );
}
