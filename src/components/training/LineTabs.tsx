import clsx from 'clsx';

export type LineTab = 'continuation' | 'refutation' | 'playedRefutation';

/** Small tab strip for switching between the continuation / refutation lines in the analysis panel. */
export function LineTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: { key: LineTab; label: string }[];
  active: LineTab;
  onSelect: (key: LineTab) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onSelect(t.key)}
          className={clsx(
            'font-mono uppercase text-[10px] tracking-tight px-2 py-1 rounded-none border-2 transition-colors',
            active === t.key
              ? 'bg-accent/15 border-accent text-text-primary'
              : 'border-text-primary text-text-secondary hover:bg-accent/10',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
