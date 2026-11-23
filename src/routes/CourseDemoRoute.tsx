import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BrandLockup } from '../components/BrandLogo';
import { Skeleton } from '../components/Skeleton';
import { LessonPlayer } from '../components/courses/LessonPlayer';
import type { LearnStudy } from '../models/learn';
import { loadLesson } from '../lib/courseLessons';
import { useForceDefaultTheme } from '../state/themeStore';
import { useHead } from '../seo/useHead';

/**
 * Unlisted interactive course built from a creator's video (/c/<slug>). Public
 * and logged-out: it's the link in a creator pitch, so nothing here may need an
 * account. Courses live in src/generated/courses/ (never the /learn index) and
 * the page is noindex — the slug carries a random suffix so it isn't guessable.
 */

const CONTACT_EMAIL = 'elliot@patternchess.com';

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
    queryFn: () => loadLesson(slug),
    staleTime: Infinity,
  });

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <header className="p-4 border-b-2 border-text-primary/20">
        <Link to="/" className="inline-flex">
          <BrandLockup size="sm" />
        </Link>
      </header>
      <main className="flex-1 p-4 md:p-6 w-full max-w-7xl mx-auto">
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

/** The demo: the shared lesson player, then the pitch to the creator. */
function CoursePlayer({ course }: { course: LearnStudy }) {
  const [finished, setFinished] = useState(false);
  const [round, setRound] = useState(0);
  const source = course.source;
  const header = (
    <>
      <span className="label">Interactive course preview</span>
      <h1 className="heading-lg">{course.title}</h1>
      {source && (
        <p className="text-text-primary text-sm" data-testid="course-credit">
          From{' '}
          <a href={source.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            {source.title}
          </a>{' '}
          by{' '}
          <a href={source.channelUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            {source.channel}
          </a>
        </p>
      )}
    </>
  );
  if (finished) {
    return (
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-2">{header}</header>
        <CourseComplete
          course={course}
          onRestart={() => {
            setFinished(false);
            setRound((r) => r + 1);
          }}
        />
      </div>
    );
  }
  return <LessonPlayer key={round} study={course} header={header} onFinish={() => setFinished(true)} />;
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
