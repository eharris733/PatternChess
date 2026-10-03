import { Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { studiesInCategory } from '../learn/catalog';
import {
  LEARN_CATEGORY_LABEL,
  LEARN_CATEGORY_ORDER,
  LEARN_LEVEL_LABEL,
  type LearnCategory,
} from '../models/learn';
import { completedChapters } from '../state/learnDrillStore';

const INTRO: Record<LearnCategory, string> = {
  openings: 'Repertoires worth knowing. The Openings tab suggests these when your games leave theory.',
  strategy: 'Plans, pawn structures and the ideas behind good middlegame moves.',
  endgames: 'The theoretical positions and technique that turn advantages into wins.',
};

function parseCategory(v: string | null): LearnCategory {
  return v === 'strategy' || v === 'endgames' ? v : 'openings';
}

export function LearnRoute() {
  const [params, setParams] = useSearchParams();
  const tab = parseCategory(params.get('tab'));
  const setTab = (next: LearnCategory) => {
    const p = new URLSearchParams(params);
    if (next === 'openings') p.delete('tab');
    else p.set('tab', next);
    setParams(p, { replace: true });
  };
  const studies = studiesInCategory(tab);

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <span className="label">Learn</span>
        <h1 className="heading-xl">Study library</h1>
        <p className="text-text-secondary text-sm">
          Hand-picked Lichess studies, credited to their authors. Read through each line, then drill
          it on the board.
        </p>
      </header>

      <div role="tablist" aria-label="Study category" className="flex gap-1.5 flex-wrap">
        {LEARN_CATEGORY_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            data-testid={`tab-${id}`}
            onClick={() => setTab(id)}
            className={clsx(
              'px-4 py-2 text-sm font-mono uppercase tracking-tight border-2 rounded-none transition-colors',
              tab === id
                ? 'bg-text-primary text-bg border-text-primary'
                : 'bg-surface text-text-primary border-text-primary hover:bg-accent/15',
            )}
          >
            {LEARN_CATEGORY_LABEL[id]}
          </button>
        ))}
      </div>

      <p className="text-text-secondary text-sm">{INTRO[tab]}</p>

      {studies.length === 0 ? (
        <div className="card" data-testid="learn-empty">
          <p className="text-text-secondary text-sm">
            No {LEARN_CATEGORY_LABEL[tab].toLowerCase()} studies yet. New ones are being added.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {studies.map((s) => {
            const done = completedChapters(s.slug).size;
            return (
              <li key={s.slug}>
                <Link
                  to={`/learn/${s.slug}`}
                  className="card !p-4 flex flex-col gap-2 h-full hover:shadow-card-hover transition-shadow"
                  data-testid="study-card"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="font-mono uppercase tracking-tight text-text-primary">{s.title}</h2>
                    <span className="label shrink-0">{LEARN_LEVEL_LABEL[s.level]}</span>
                  </div>
                  {s.description && <p className="text-text-secondary text-sm">{s.description}</p>}
                  <p className="text-text-secondary text-xs mt-auto">
                    by {s.author} · {s.chapters.length} chapters
                    {done > 0 && ` · ${done} drilled`}
                    {s.color && ` · for ${s.color === 'white' ? 'White' : 'Black'}`}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
