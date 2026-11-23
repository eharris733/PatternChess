import { useMemo } from 'react';
import { ALL_MOTIFS, MOTIF_LABEL, type Motif } from '../../chess/motifs';
import {
  DRILL_KIND_LABEL,
  PHASE_LABEL,
  PHASE_ORDER,
  SR_BUCKET_LABEL,
  SR_BUCKET_ORDER,
  type BlunderPhase,
  type DrillKind,
  type SrBucket,
} from '../../models/blunder';
import {
  activeFilterCount,
  COLOR_LABEL,
  facetCounts,
  openingOptions,
  type PlayerColor,
  type PositionFacts,
  type PositionFilters,
} from './vaultFilters';
import { VaultSelect } from './VaultSelect';
import type { PositionsMode } from './VaultPositionsTab';

const KIND_ORDER: readonly DrillKind[] = ['tactic', 'endgame', 'opening'];
const COLORS: readonly PlayerColor[] = ['white', 'black'];

const count = (n: number | undefined) => <span className="ml-1.5 text-text-primary">{n ?? 0}</span>;

/**
 * Type and progress pills, then motif / phase / opening / color selects and a
 * date range. Every option counts the positions it would leave given the
 * other filters.
 */
export function VaultFilterBar({
  mode,
  facts,
  filters,
  onChange,
  onClear,
}: {
  mode: PositionsMode;
  facts: readonly PositionFacts[];
  filters: PositionFilters;
  onChange: (patch: Partial<PositionFilters>) => void;
  onClear: () => void;
}) {
  const kinds = useMemo(() => facetCounts(facts, filters, 'kind', (f) => [f.blunder.kind]), [facts, filters]);
  const buckets = useMemo(() => facetCounts(facts, filters, 'progress', (f) => [f.bucket]), [facts, filters]);
  const motifs = useMemo(() => facetCounts(facts, filters, 'motif', (f) => f.blunder.motifs), [facts, filters]);
  const phases = useMemo(() => facetCounts(facts, filters, 'phase', (f) => [f.blunder.phase]), [facts, filters]);
  const colors = useMemo(() => facetCounts(facts, filters, 'color', (f) => [f.color]), [facts, filters]);
  const openings = useMemo(
    () => openingOptions(facetCounts(facts, filters, 'opening', (f) => (f.openingFamily ? [f.openingFamily] : []))),
    [facts, filters],
  );

  const kindsPresent = useMemo(() => {
    const set = new Set(facts.map((f) => f.blunder.kind));
    return KIND_ORDER.filter((k) => set.has(k));
  }, [facts]);
  const motifsPresent = useMemo(() => {
    const set = new Set(facts.flatMap((f) => f.blunder.motifs));
    return ALL_MOTIFS.filter((m) => set.has(m) || m === filters.motif);
  }, [facts, filters.motif]);
  const openingList = useMemo(
    () => (filters.opening && !openings.some(([o]) => o === filters.opening) ? [...openings, [filters.opening, 0] as [string, number]] : openings),
    [openings, filters.opening],
  );
  const kindTotal = useMemo(() => [...kinds.values()].reduce((a, b) => a + b, 0), [kinds]);
  const bucketTotal = useMemo(() => [...buckets.values()].reduce((a, b) => a + b, 0), [buckets]);
  const active = activeFilterCount(filters);

  return (
    <div className="flex flex-col gap-2" data-testid="vault-filters">
      {kindsPresent.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by type">
          <button type="button" className="pill" aria-pressed={!filters.kind} onClick={() => onChange({ kind: null })}>
            All{count(kindTotal)}
          </button>
          {kindsPresent.map((k) => (
            <button
              key={k}
              type="button"
              className="pill"
              aria-pressed={filters.kind === k}
              onClick={() => onChange({ kind: k })}
            >
              {DRILL_KIND_LABEL[k]}
              {count(kinds.get(k))}
            </button>
          ))}
        </div>
      )}
      {mode === 'blunders' && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by progress">
          <button
            type="button"
            className="pill"
            aria-pressed={!filters.progress}
            onClick={() => onChange({ progress: null })}
          >
            Any progress{count(bucketTotal)}
          </button>
          {SR_BUCKET_ORDER.map((k: SrBucket) => (
            <button
              key={k}
              type="button"
              className="pill"
              aria-pressed={filters.progress === k}
              onClick={() => onChange({ progress: k })}
            >
              {SR_BUCKET_LABEL[k]}
              {count(buckets.get(k))}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        {motifsPresent.length > 0 && (
          <VaultSelect
            fill
            aria-label="Motif"
            data-testid="vault-filter-motif"
            value={filters.motif ?? ''}
            onChange={(e) => onChange({ motif: (e.target.value || null) as Motif | null })}
          >
            <option value="">Any motif</option>
            {motifsPresent.map((m) => (
              <option key={m} value={m}>
                {MOTIF_LABEL[m]} ({motifs.get(m) ?? 0})
              </option>
            ))}
          </VaultSelect>
        )}
        <VaultSelect
          fill
          aria-label="Phase"
          data-testid="vault-filter-phase"
          value={filters.phase ?? ''}
          onChange={(e) => onChange({ phase: (e.target.value || null) as BlunderPhase | null })}
        >
          <option value="">Any phase</option>
          {PHASE_ORDER.map((p) => (
            <option key={p} value={p}>
              {PHASE_LABEL[p]} ({phases.get(p) ?? 0})
            </option>
          ))}
        </VaultSelect>
        {openingList.length > 0 && (
          <VaultSelect
            fill
            aria-label="Opening"
            data-testid="vault-filter-opening"
            className="sm:max-w-[16rem]"
            value={filters.opening ?? ''}
            onChange={(e) => onChange({ opening: e.target.value || null })}
          >
            <option value="">Any opening</option>
            {openingList.map(([name, n]) => (
              <option key={name} value={name}>
                {name} ({n})
              </option>
            ))}
          </VaultSelect>
        )}
        <VaultSelect
          fill
          aria-label="Your color"
          data-testid="vault-filter-color"
          value={filters.color ?? ''}
          onChange={(e) => onChange({ color: (e.target.value || null) as PlayerColor | null })}
        >
          <option value="">Either color</option>
          {COLORS.map((c) => (
            <option key={c} value={c}>
              As {COLOR_LABEL[c]} ({colors.get(c) ?? 0})
            </option>
          ))}
        </VaultSelect>
        <div className="col-span-2 flex items-center gap-1.5" role="group" aria-label="Game date">
          <input
            type="date"
            className="input h-9 min-w-0 flex-1 sm:flex-none sm:w-[9.5rem]"
            aria-label="Played on or after"
            data-testid="vault-filter-from"
            value={filters.from ?? ''}
            max={filters.to ?? undefined}
            onChange={(e) => onChange({ from: e.target.value || null })}
          />
          <span className="text-text-primary text-sm" aria-hidden>
            to
          </span>
          <input
            type="date"
            className="input h-9 min-w-0 flex-1 sm:flex-none sm:w-[9.5rem]"
            aria-label="Played on or before"
            data-testid="vault-filter-to"
            value={filters.to ?? ''}
            min={filters.from ?? undefined}
            onChange={(e) => onChange({ to: e.target.value || null })}
          />
        </div>
        {active > 0 && (
          <button
            type="button"
            className="btn-ghost h-9 px-3 text-sm col-span-2 justify-self-start"
            onClick={onClear}
            data-testid="vault-filters-clear"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
