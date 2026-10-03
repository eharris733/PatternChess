import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackLink } from '../components/BackLink';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { BoardPanel } from '../components/BoardPanel';
import { Skeleton } from '../components/Skeleton';
import { MoveTree } from '../components/learn/MoveTree';
import { parseUciMove } from '../chess/moveUtils';
import { loadStudy, studyBySlug } from '../learn/catalog';
import type { LearnChapter, LearnNode } from '../models/learn';
import { useAuth } from '../auth/useAuth';
import { authService } from '../services/authService';
import {
  completedChapters,
  drillFen,
  markChapterCompleted,
  useLearnDrillStore,
} from '../state/learnDrillStore';

type Mode = 'explore' | 'drill';

function lastMoveOf(node: LearnNode | undefined): [string, string] | null {
  if (!node) return null;
  const m = parseUciMove(node.uci);
  return [m.from, m.to];
}

/** id → parent (null for first moves), for walking back up the tree. */
function parentMap(chapter: LearnChapter): Map<string, LearnNode | null> {
  const out = new Map<string, LearnNode | null>();
  const walk = (nodes: LearnNode[], parent: LearnNode | null) => {
    for (const n of nodes) {
      out.set(n.id, parent);
      walk(n.children, n);
    }
  };
  walk(chapter.moves, null);
  return out;
}

function ExploreView({ chapter }: { chapter: LearnChapter }) {
  const parents = useMemo(() => parentMap(chapter), [chapter]);
  const nodes = useMemo(() => {
    const byId = new Map<string, LearnNode>();
    const walk = (ns: LearnNode[]) => ns.forEach((n) => (byId.set(n.id, n), walk(n.children)));
    walk(chapter.moves);
    return byId;
  }, [chapter]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => setSelectedId(null), [chapter]);
  const selected = selectedId ? nodes.get(selectedId) : undefined;

  const forward = useCallback(() => {
    const next = selected ? selected.children[0] : chapter.moves[0];
    if (next) setSelectedId(next.id);
  }, [selected, chapter]);
  const back = useCallback(() => {
    if (!selected) return;
    setSelectedId(parents.get(selected.id)?.id ?? null);
  }, [selected, parents]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        forward();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [forward, back]);

  const comment = selected ? selected.comment : chapter.intro;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
      <BoardPanel
        fen={selected?.fen ?? chapter.startFen}
        orientation={chapter.orientation}
        movableFor={null}
        lastMove={lastMoveOf(selected)}
        shapes={selected ? selected.shapes : chapter.introShapes}
      />
      <div className="flex flex-col gap-3 min-w-0">
        <div className="card !p-4 min-h-[5rem]" data-testid="learn-comment">
          {comment ? (
            <p className="text-sm text-text-primary">{comment}</p>
          ) : (
            <p className="text-sm text-text-secondary">
              {selected ? 'No comment on this move.' : 'Step through the moves with the arrow keys.'}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" className="pill flex-1" onClick={back} disabled={!selected}>
            Back
          </button>
          <button type="button" className="pill flex-1" onClick={forward} data-testid="learn-next">
            Next
          </button>
        </div>
        <div className="card !p-3 max-h-[28rem] overflow-y-auto">
          <MoveTree moves={chapter.moves} selectedId={selectedId} onSelect={(n) => setSelectedId(n.id)} />
        </div>
      </div>
    </div>
  );
}

function DrillView({
  chapter,
  slug,
  onNextChapter,
}: {
  chapter: LearnChapter;
  slug: string;
  onNextChapter: (() => void) | null;
}) {
  const drill = useLearnDrillStore();
  const { profile, refreshProfile } = useAuth();
  useEffect(() => {
    useLearnDrillStore.getState().start(chapter);
    return () => useLearnDrillStore.getState().reset();
  }, [chapter]);
  useEffect(() => {
    if (drill.phase !== 'done' || drill.chapter?.id !== chapter.id) return;
    markChapterCompleted(slug, chapter.id);
    // Durable copy for the Learn achievements (localStorage is per browser).
    const key = `${slug}/${chapter.id}`;
    if (profile && !profile.learnChaptersDone.includes(key)) {
      void authService
        .markLearnChapterDone(key)
        .then(() => refreshProfile())
        .catch((err) => console.warn('[learn] record chapter failed', err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drill.phase, drill.chapter, chapter.id, slug]);

  const fen = drillFen(drill) || chapter.startFen;
  const status =
    drill.phase === 'done'
      ? drill.totalMisses === 0
        ? 'Line complete, no mistakes.'
        : `Line complete with ${drill.totalMisses} ${drill.totalMisses === 1 ? 'miss' : 'misses'}.`
      : drill.phase === 'opponent'
        ? 'Opponent is replying…'
        : `Your move as ${chapter.orientation === 'white' ? 'White' : 'Black'}.`;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
      <BoardPanel
        fen={fen}
        orientation={chapter.orientation}
        movableFor={drill.phase === 'yourMove' ? chapter.orientation : null}
        lastMove={lastMoveOf(drill.path.at(-1))}
        shapes={drill.shapes}
        onMove={(m) => drill.play(`${m.from}${m.to}${m.promotion ?? ''}`)}
      />
      <div className="flex flex-col gap-3 min-w-0">
        <div className="card !p-4 flex flex-col gap-2" data-testid="learn-drill-status">
          <span className="label">Drill the line</span>
          <p className={clsx('text-sm', drill.phase === 'done' ? 'text-correct' : 'text-text-primary')}>
            {status}
          </p>
          {drill.message && (
            <p className="text-sm text-text-secondary" data-testid="learn-drill-message">
              {drill.message}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" className="pill flex-1" onClick={() => drill.start(chapter)}>
            Restart
          </button>
          {drill.phase === 'done' && onNextChapter && (
            <button type="button" className="pill flex-1" onClick={onNextChapter}>
              Next chapter
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function LearnStudyRoute() {
  const { slug = '', chapter: chapterParam } = useParams();
  const navigate = useNavigate();
  const meta = studyBySlug(slug);
  const studyQuery = useQuery({
    queryKey: ['learn', 'study', slug],
    queryFn: () => loadStudy(slug),
    enabled: !!meta,
    staleTime: Infinity,
  });
  const [mode, setMode] = useState<Mode>('explore');

  if (!meta) {
    return (
      <div className="max-w-3xl mx-auto card flex flex-col gap-3">
        <h1 className="heading-md">Study not found</h1>
        <Link to="/learn" className="pill self-start">
          Back to the library
        </Link>
      </div>
    );
  }

  const study = studyQuery.data;
  const chapters = study?.chapterData ?? [];
  const index = Math.max(0, chapters.findIndex((c) => c.id === chapterParam));
  const chapter = chapters[index];
  const done = completedChapters(slug);
  const goTo = (i: number) => navigate(`/learn/${slug}/${chapters[i].id}`, { replace: true });
  const annotator = chapter?.annotator ?? meta.author;

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <BackLink to={`/learn${meta.category === 'openings' ? '' : `?tab=${meta.category}`}`} label="Learn" />
        <h1 className="heading-lg">{meta.title}</h1>
        <p className="text-text-secondary text-sm" data-testid="learn-attribution">
          Study by{' '}
          <a href={`https://lichess.org/@/${annotator}`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            {annotator}
          </a>{' '}
          ·{' '}
          <a href={chapter?.url || meta.studyUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            View on Lichess
          </a>
          {meta.permissionNote && <span className="block text-xs mt-1">{meta.permissionNote}</span>}
        </p>
      </header>

      {studyQuery.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : !chapter ? (
        <p className="text-text-secondary text-sm">This study has no chapters.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <label className="flex items-center gap-2 text-sm min-w-0">
              <span className="label">Chapter</span>
              <select
                className="input !h-9 !w-auto max-w-[70vw]"
                value={chapter.id}
                onChange={(e) => goTo(chapters.findIndex((c) => c.id === e.target.value))}
                data-testid="learn-chapter-select"
              >
                {chapters.map((c, i) => (
                  <option key={c.id} value={c.id}>
                    {i + 1}. {c.name}
                    {done.has(c.id) ? ' (drilled)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <div role="tablist" aria-label="Mode" className="flex gap-1.5">
              {(
                [
                  ['explore', 'Read'],
                  ['drill', 'Drill'],
                ] as Array<[Mode, string]>
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={mode === id}
                  data-testid={`mode-${id}`}
                  onClick={() => setMode(id)}
                  disabled={id === 'drill' && chapter.moves.length === 0}
                  className={clsx(
                    'px-4 py-2 text-sm font-mono uppercase tracking-tight border-2 rounded-none transition-colors',
                    mode === id
                      ? 'bg-text-primary text-bg border-text-primary'
                      : 'bg-surface text-text-primary border-text-primary hover:bg-accent/15',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {mode === 'explore' ? (
            <ExploreView chapter={chapter} />
          ) : (
            <DrillView
              chapter={chapter}
              slug={slug}
              onNextChapter={index + 1 < chapters.length ? () => goTo(index + 1) : null}
            />
          )}
        </>
      )}
    </div>
  );
}
