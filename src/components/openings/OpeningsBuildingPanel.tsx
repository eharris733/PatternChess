import { useRef } from 'react';
import { useAuth } from '../../auth/useAuth';
import { useSyncStore } from '../../state/syncStore';
import { scanItemsLeft, type OpeningScanState } from '../../state/openingScanStore';
import type { LibraryProgress } from '../../hooks/useLibraryProgress';
import { ProgressBar } from '../ProgressBar';
import { StepMarker } from '../OnboardingImport';
import { useT } from '../../i18n/useT';

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
  const t = useT();
  const triggerNow = useSyncStore((s) => s.triggerNow);

  const importing = library.phase === 'importing';
  const analyzing = library.phase === 'analyzing';
  const analysisDone = !importing && !analyzing && scan.unanalyzed === 0 && scan.phase !== 'idle';
  const left = scanItemsLeft(scan);
  // The queue shrinks as games are checked: measure against its high-water mark.
  const peak = useRef(0);
  peak.current = Math.max(peak.current, left);
  // The walk (and the most-played opening's engine checks) run during sync too.
  const checking = scan.phase === 'checking' || (analysisDone && scan.phase !== 'done');

  const analyzeDetail = analyzing
    ? t('building.analyzeOf', { done: library.analyzed, total: library.analyzeTotal })
    : importing
      ? t('building.afterImport')
      : scan.unanalyzed > 0
        ? t('openings.waiting', { count: scan.unanalyzed }).replace(/\.$/, '')
        : scan.phase === 'idle'
          ? t('building.checking')
          : t('building.allAnalyzed');

  const checkDetail = !analysisDone
    ? scan.phase === 'checking' || scan.phase === 'waiting'
      ? t('building.mostPlayedFirst')
      : t('building.asGamesComeIn')
    : scan.bookUnavailable
      ? t('openings.bookDown')
      : scan.phase === 'done'
        ? t('building.done')
        : left > 0
          ? t('building.itemsLeft', { count: left })
          : t('building.finishing');

  return (
    <section className="card flex flex-col gap-5" data-testid="openings-building" aria-live="polite">
      <div className="flex flex-col gap-2">
        <h2 className="heading-md">{t('building.title')}</h2>
        <p className="text-text-primary text-sm">
          {t('building.body')}
        </p>
      </div>

      <ol className="flex flex-col gap-4">
        <Step
          label={t('building.import')}
          done={!importing}
          active={importing}
          detail={
            importing
              ? library.importTotal
                ? t('building.importOf', { done: library.imported, total: library.importTotal })
                : t('building.importNew', { count: library.imported })
              : t('building.importDone')
          }
          bar={importing && library.importTotal ? { current: library.imported, total: library.importTotal } : null}
        />
        <Step
          label={t('building.analyze')}
          done={analysisDone}
          active={analyzing || (!importing && !analysisDone)}
          detail={analyzeDetail}
          bar={analyzing && library.analyzeTotal > 0 ? { current: library.analyzed, total: library.analyzeTotal } : null}
        />
        <Step
          label={t('building.check')}
          done={analysisDone && scan.phase === 'done'}
          active={checking}
          detail={checkDetail}
          bar={checking && peak.current > 0 ? { current: peak.current - left, total: peak.current } : null}
        />
      </ol>

      {!importing && !analyzing && scan.unanalyzed > 0 && (profile?.lichessUsername || profile?.chesscomUsername) && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-text-primary text-sm">{t('building.analysisRuns')}</p>
          <button type="button" className="btn-outline" onClick={() => profile && void triggerNow(profile)}>
            {t('vault.games.syncNow')}
          </button>
        </div>
      )}

      <p className="text-text-primary text-sm">
        {t('building.background')}
      </p>

      {onShowPartial && (scan.bookUnavailable || scan.phase === 'stopped') && (
        <button type="button" className="pill self-start" onClick={onShowPartial}>
          {t('building.showPartial')}
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
