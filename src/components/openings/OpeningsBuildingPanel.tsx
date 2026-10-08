import { useRef } from 'react';
import { useAuth } from '../../auth/useAuth';
import { useSyncStore } from '../../state/syncStore';
import { scanItemsLeft, type OpeningScanState } from '../../state/openingScanStore';
import type { LibraryProgress } from '../../hooks/useLibraryProgress';
import { ProgressBar } from '../ProgressBar';
import { StepMarker } from '../OnboardingImport';

/**
 * Shown on /openings until the first full report is ready: the three things
 * it waits on (import, game analysis, the theory check) as a checklist, so
 * nobody reads a half-built page — or a "Paused" — as the result.
 */
export function OpeningsBuildingPanel({
  library,
  scan,
  onShowPartial,
}: {
  library: LibraryProgress;
  scan: OpeningScanState;
  /** Escape hatch when the check can't finish right now (book down, stopped). */
  onShowPartial?: () => void;
}) {
  const { profile } = useAuth();
  const triggerNow = useSyncStore((s) => s.triggerNow);

  const importing = library.phase === 'importing';
  const analyzing = library.phase === 'analyzing';
  const analysisDone = !importing && !analyzing && scan.unanalyzed === 0 && scan.phase !== 'idle';
  const left = scanItemsLeft(scan);
  // The queue shrinks as games are checked: measure against its high-water mark.
  const peak = useRef(0);
  peak.current = Math.max(peak.current, left);
  const checking = analysisDone && scan.phase !== 'done';

  const analyzeDetail = analyzing
    ? `${library.analyzed} / ${library.analyzeTotal} games`
    : importing
      ? 'Starts once your games are imported'
      : scan.unanalyzed > 0
        ? `${scan.unanalyzed} ${scan.unanalyzed === 1 ? 'game is' : 'games are'} waiting to be analyzed`
        : scan.phase === 'idle'
          ? 'Checking…'
          : 'All games analyzed';

  const checkDetail = !analysisDone
    ? 'Starts once every game is analyzed'
    : scan.bookUnavailable
      ? "Can't reach the opening book right now. Retrying shortly."
      : scan.phase === 'done'
        ? 'Done'
        : left > 0
          ? `${left} ${left === 1 ? 'item' : 'items'} left`
          : 'Finishing up…';

  return (
    <section className="card flex flex-col gap-5" data-testid="openings-building" aria-live="polite">
      <div className="flex flex-col gap-2">
        <h2 className="heading-md">Building your openings report</h2>
        <p className="text-text-primary text-sm">
          We compare every game you've played with master theory to find where you leave the book and
          which of those exits cost you. That needs all of your games analyzed first, so your report
          appears here once the steps below are done.
        </p>
      </div>

      <ol className="flex flex-col gap-4">
        <Step
          label="Import your games"
          done={!importing}
          active={importing}
          detail={
            importing
              ? library.importTotal
                ? `${library.imported} / ${library.importTotal}`
                : `${library.imported} new ${library.imported === 1 ? 'game' : 'games'} so far`
              : 'Your games are in'
          }
          bar={importing && library.importTotal ? { current: library.imported, total: library.importTotal } : null}
        />
        <Step
          label="Analyze every game"
          done={analysisDone}
          active={analyzing || (!importing && !analysisDone)}
          detail={analyzeDetail}
          bar={analyzing && library.analyzeTotal > 0 ? { current: library.analyzed, total: library.analyzeTotal } : null}
        />
        <Step
          label="Check your openings against theory"
          done={analysisDone && scan.phase === 'done'}
          active={checking}
          detail={checkDetail}
          bar={checking && peak.current > 0 ? { current: peak.current - left, total: peak.current } : null}
        />
      </ol>

      {!importing && !analyzing && scan.unanalyzed > 0 && (profile?.lichessUsername || profile?.chesscomUsername) && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-text-primary text-sm">Game analysis runs while your games sync.</p>
          <button type="button" className="btn-outline" onClick={() => profile && void triggerNow(profile)}>
            Sync now
          </button>
        </div>
      )}

      <p className="text-text-primary text-sm">
        This keeps running while this page or the dashboard is open, and the page updates by itself when
        it's ready.
      </p>

      {onShowPartial && (scan.bookUnavailable || scan.phase === 'stopped') && (
        <button type="button" className="pill self-start" onClick={onShowPartial}>
          Show what's ready so far
        </button>
      )}
    </section>
  );
}

function Step({
  label,
  done,
  active,
  detail,
  bar,
}: {
  label: string;
  done: boolean;
  active: boolean;
  detail: string;
  bar: { current: number; total: number } | null;
}) {
  return (
    <li className="flex flex-col gap-2" data-state={done ? 'done' : active ? 'active' : 'pending'}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StepMarker done={done} active={active && !done} />
        <span className="text-text-primary font-medium">{label}</span>
        <span className="text-sm text-text-primary">· {detail}</span>
      </div>
      {bar && <ProgressBar current={bar.current} total={bar.total} />}
    </li>
  );
}
