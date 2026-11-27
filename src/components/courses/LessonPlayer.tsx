import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { BoardPanel } from '../BoardPanel';
import { parseUciMove } from '../../chess/moveUtils';
import type { LearnNode, LearnStudy } from '../../models/learn';
import { splitCommentLines, type CommentLine } from '../../learn/commentLines';
import { countChapterMoments, drillFen, useLearnDrillStore } from '../../state/learnDrillStore';
import { YouTubeEmbed, useYouTubePlayer, youtubeIdFromUrl, type YouTubePlayer } from '../youtube/YouTubeEmbed';

function lastMoveOf(node: LearnNode | undefined): [string, string] | null {
  if (!node) return null;
  const m = parseUciMove(node.uci);
  return [m.from, m.to];
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}:${String(seconds % 60).padStart(2, '0')}`;
}

const STANDARD_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const LEAD_IN_MS = 380;
const LINE_STEP_MS = 650;

/** "1.e4 c5 2.Nf3" — moves numbered from `fen`'s move counter and side to move. */
function numbered(fen: string, sans: string[]): string {
  const [, side, , , , full] = fen.split(' ');
  let move = Number(full) || 1;
  let black = side === 'b';
  return sans
    .map((san, i) => {
      const prefix = !black ? `${move}.` : i === 0 ? `${move}...` : '';
      if (black) move++;
      black = !black;
      return `${prefix}${san}`;
    })
    .join(' ');
}

function uciPair(uci: string): [string, string] {
  const m = parseUciMove(uci);
  return [m.from, m.to];
}

/** A move line from a comment, stepping on the board. */
interface LinePreview {
  line: CommentLine;
  ply: number;
}

export interface LessonPlayerProps {
  /** The lesson: an annotated PGN converted by `npm run learn:sync` (src/generated/course-lessons/ or src/generated/courses/). */
  study: LearnStudy;
  /** Called by the last chapter's Finish button. */
  onFinish: () => void;
  /** Label for that button (default "Finish"). */
  finishLabel?: string;
  /** Shown above the progress bar (title, credit). */
  header?: ReactNode;
  /**
   * The video to watch along with. Defaults to the study's own source video
   * from its first moment; a course day passes its clip instead.
   */
  video?: YouTubePlayer;
  /** Title for the embedded video frame. */
  videoTitle?: string;
}

/**
 * The interactive lesson player shared by the creator-course demo (/c/:slug)
 * and course days (/courses/:slug/:day): each chapter's lead-in autoplays,
 * then `learnDrillStore` drills the main line, pausing on the creator's notes
 * (paraphrased in the PGN comments, `[%ts]` links back to the video).
 */
export function LessonPlayer({
  study: course,
  onFinish,
  finishLabel = 'Finish',
  header,
  video: videoProp,
  videoTitle,
}: LessonPlayerProps) {
  const chapters = course.chapterData;
  const [index, setIndex] = useState(0);
  // Plies of the chapter's lead-in shown so far; null once the drill runs.
  const [leadPly, setLeadPly] = useState<number | null>(null);
  const [preview, setPreview] = useState<LinePreview | null>(null);
  const chapter = chapters[index];
  const leadIn = chapter.leadIn ?? [];
  const drill = useLearnDrillStore();
  const rootRef = useRef<HTMLDivElement>(null);

  // The board is sized to the viewport; when the page header pushes it below
  // the fold, bring the player to the top once so board and coach both show.
  // (After a beat: the board chunk loads lazily, so measure once it's laid out.)
  useEffect(() => {
    const t = setTimeout(() => {
      const el = rootRef.current;
      if (!el || window.scrollY > 0) return;
      const board = el.querySelector('cg-board') ?? el;
      if (board.getBoundingClientRect().bottom > window.innerHeight) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 400);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    setPreview(null);
    if (chapter.leadIn?.length) {
      useLearnDrillStore.getState().reset();
      setLeadPly(0);
    } else {
      setLeadPly(null);
      useLearnDrillStore.getState().start(chapter, { runs: true });
    }
    return () => useLearnDrillStore.getState().reset();
  }, [chapter]);

  // Autoplay the moves that reach the chapter's position, then start the drill.
  useEffect(() => {
    if (leadPly == null) return;
    if (leadPly >= leadIn.length) {
      setLeadPly(null);
      useLearnDrillStore.getState().start(chapter, { runs: true });
      return;
    }
    const t = setTimeout(() => setLeadPly(leadPly + 1), leadPly === 0 ? 700 : LEAD_IN_MS);
    return () => clearTimeout(t);
  }, [leadPly, leadIn.length, chapter]);

  // Step a clicked line, then hold its final position.
  useEffect(() => {
    if (!preview || preview.ply >= preview.line.moves.length) return;
    const t = setTimeout(
      () => setPreview((p) => (p ? { ...p, ply: p.ply + 1 } : p)),
      preview.ply === 0 ? 400 : LINE_STEP_MS,
    );
    return () => clearTimeout(t);
  }, [preview]);

  // A new message or move ends any line being shown.
  useEffect(() => setPreview(null), [drill.message, drill.path]);

  const isLast = index + 1 >= chapters.length;
  const skipLeadIn = () => setLeadPly(leadIn.length);
  const nextChapter = () => (isLast ? onFinish() : setIndex(index + 1));
  const hasNextRun = drill.chapter?.id === chapter.id && drill.runIndex + 1 < drill.runs.length;
  // Done with a line: the chapter's next line (an opponent sideline), else the next chapter.
  const afterDone = () => {
    if (hasNextRun) drill.nextRun();
    else nextChapter();
  };

  // Space / Enter does whatever the main button would: skip the setup, close
  // a shown line, continue past a note, go to the next chapter.
  const primary = useRef<() => void>(() => {});
  primary.current = () => {
    if (leadPly != null) skipLeadIn();
    else if (preview) setPreview(null);
    else if (drill.phase === 'explain') drill.next();
    else if (drill.phase === 'done') afterDone();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      // Drop focus so the keyup doesn't also click whichever button had it.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      primary.current();
    };
    // Clicking the video moves keyboard focus into the YouTube frame, where
    // our Space handler can't hear it. Take focus back after the click lands.
    const onBlur = () =>
      setTimeout(() => {
        if (document.activeElement?.tagName === 'IFRAME') rootRef.current?.focus({ preventScroll: true });
      }, 0);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const perChapter = useMemo(() => chapters.map((c) => countChapterMoments(c, true)), [chapters]);
  const onChapter = drill.chapter?.id === chapter.id;
  const here = onChapter ? drill.momentsTotal : (perChapter[index] ?? 0);
  const total = perChapter.reduce((a, b) => a + b, 0) - (perChapter[index] ?? 0) + here;
  const before = perChapter.slice(0, index).reduce((a, b) => a + b, 0);
  const done = before + Math.min(here, onChapter ? drill.momentsDone : 0);
  const runCount = onChapter ? drill.runs.length : 1;
  const branch = onChapter && drill.runIndex > 0 ? drill.runs[drill.runIndex].path : null;
  const branchLabel = branch?.length
    ? numbered(branch.at(-2)?.fen ?? chapter.startFen, [branch.at(-1)!.san])
    : null;
  const source = course.source;
  const side = chapter.orientation === 'white' ? 'White' : 'Black';
  const ownVideo = useYouTubePlayer(!videoProp && source ? youtubeIdFromUrl(source.url) : null, {
    start: chapters[0]?.introTs ?? 0,
  });
  const video = videoProp ?? ownVideo;

  // Positions a quoted line may start from, most specific first.
  const lineStarts = useMemo(
    () => [
      ...(drill.messageFen ? [drill.messageFen] : []),
      drillFen(drill) || chapter.startFen,
      ...drill.path.map((n) => n.fen).reverse(),
      chapter.startFen,
      ...leadIn.map((m) => m.fen).reverse(),
      STANDARD_FEN,
    ],
    [drill, chapter, leadIn],
  );
  const segments = useMemo(
    () => (drill.message ? splitCommentLines(drill.message, lineStarts) : []),
    [drill.message, lineStarts],
  );

  let boardFen: string;
  let boardLastMove: [string, string] | null;
  if (leadPly != null) {
    boardFen = leadPly === 0 ? STANDARD_FEN : leadIn[leadPly - 1].fen;
    boardLastMove = leadPly === 0 ? null : uciPair(leadIn[leadPly - 1].uci);
  } else if (preview) {
    const m = preview.line.moves[preview.ply - 1];
    boardFen = m?.fen ?? preview.line.fen;
    boardLastMove = m ? uciPair(m.uci) : null;
  } else {
    boardFen = drillFen(drill) || chapter.startFen;
    boardLastMove = lastMoveOf(drill.path.at(-1));
  }

  const status =
    leadIn.length > 0 && leadPly != null
      ? 'Setting up the position'
      : drill.phase === 'replay'
        ? 'Setting up the next line'
        : drill.phase === 'done'
          ? hasNextRun
            ? 'Line complete.'
            : 'Chapter complete.'
        : drill.phase === 'opponent'
          ? 'Opponent is replying…'
          : drill.phase === 'explain'
            ? null
            : `Your move as ${side}.`;

  return (
    <div ref={rootRef} tabIndex={-1} className="flex flex-col gap-5 outline-none scroll-mt-20 lg:scroll-mt-4">
      <header className="flex flex-col gap-2">
        {header}
        <div className="flex items-center gap-3" data-testid="course-progress">
          <div className="flex-1 h-2 bg-surface border border-text-primary/30" aria-hidden>
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${(done / Math.max(1, total)) * 100}%` }}
            />
          </div>
          <span className="text-sm font-mono text-text-primary whitespace-nowrap">
            Moment {Math.min(total, done + 1)} of {total}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,500px)]">
          {/* Keep the whole board above the fold: header + progress take ~230px. */}
          <div className="w-full mx-auto" style={{ maxWidth: 'max(320px, calc(100vh - 240px))' }}>
            <BoardPanel
              fen={boardFen}
              orientation={chapter.orientation}
              movableFor={leadPly == null && !preview && drill.phase === 'yourMove' ? chapter.orientation : null}
              lastMove={boardLastMove}
              shapes={leadPly != null || preview ? [] : drill.shapes}
              onMove={(m) => drill.play(`${m.from}${m.to}${m.promotion ?? ''}`)}
            />
          </div>
          <div className="flex flex-col gap-3 min-w-0">
            <div className="card !p-4 flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1 min-w-0">
                <span className="label" data-testid="course-chapter-label">
                  Chapter {index + 1} of {chapters.length}
                  {runCount > 1 && ` · Line ${drill.runIndex + 1} of ${runCount}`}
                </span>
                <h2 className="text-base font-semibold text-text-primary">{chapter.name}</h2>
              </div>
              <button
                type="button"
                className="pill shrink-0"
                onClick={() => {
                  setPreview(null);
                  setLeadPly(leadIn.length > 0 ? 0 : null);
                  if (leadIn.length === 0) drill.start(chapter, { runs: true });
                }}
              >
                Restart
              </button>
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
              {leadPly != null ? (
                <>
                  <p className="text-sm font-mono text-text-primary leading-relaxed" data-testid="course-leadin">
                    {numbered(STANDARD_FEN, leadIn.slice(0, Math.max(1, leadPly)).map((m) => m.san))}
                  </p>
                  <button type="button" className="btn-outline self-start" onClick={skipLeadIn}>
                    Skip <SpaceHint />
                  </button>
                </>
              ) : (
                <>
                  {branchLabel && (
                    <p className="text-sm font-mono text-text-primary" data-testid="course-branch">
                      Instead: {branchLabel}
                    </p>
                  )}
                  {drill.message && (
                    <p className="text-sm text-text-primary leading-relaxed" data-testid="course-message">
                      {segments.map((seg, i) =>
                        seg.line ? (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setPreview({ line: seg.line!, ply: 0 })}
                            className={clsx(
                              'font-semibold underline decoration-dotted underline-offset-2 hover:text-accent',
                              preview?.line === seg.line && 'text-accent',
                            )}
                            data-testid="course-line"
                          >
                            {seg.text}
                          </button>
                        ) : (
                          <span key={i}>{seg.text}</span>
                        ),
                      )}
                    </p>
                  )}
                  {preview && (
                    <div
                      className="flex flex-wrap items-center gap-2 border-t border-text-primary/20 pt-3"
                      data-testid="course-line-preview"
                    >
                      <span className="text-sm font-mono text-text-primary">
                        {numbered(
                          preview.line.fen,
                          preview.line.moves.map((m) => m.san),
                        )}
                      </span>
                      <button
                        type="button"
                        className="pill"
                        onClick={() => setPreview({ line: preview.line, ply: 0 })}
                      >
                        Replay
                      </button>
                      <button type="button" className="pill" onClick={() => setPreview(null)}>
                        Back to the lesson <SpaceHint />
                      </button>
                    </div>
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
                  {!preview && drill.phase === 'explain' && (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={drill.next}
                      data-testid="course-continue"
                    >
                      Continue <SpaceHint />
                    </button>
                  )}
                  {!preview && drill.phase === 'done' && (
                    <button type="button" className="btn-primary" onClick={afterDone} data-testid="course-next">
                      {hasNextRun ? 'Next line' : isLast ? finishLabel : 'Next chapter'} <SpaceHint />
                    </button>
                  )}
                </>
              )}
            </div>
            {video.src && (
              <div className="card !p-3 flex flex-col gap-2" data-testid="lesson-video">
                <span className="label">Watch along</span>
                <YouTubeEmbed player={video} title={videoTitle ?? source?.title ?? course.title} testId="course-video" />
              </div>
            )}
          </div>
        </div>
    </div>
  );
}

function SpaceHint() {
  return (
    <kbd className="ml-1 px-1.5 py-0.5 text-[0.65rem] font-mono border border-current/40 opacity-80">Space</kbd>
  );
}

