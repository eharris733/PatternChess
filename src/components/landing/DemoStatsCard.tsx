interface Props {
  gamesAnalyzed: number;
  blundersFound: number;
  biggestSwing: number | null;
  opening: string | null;
}

export function DemoStatsCard({ gamesAnalyzed, blundersFound, biggestSwing, opening }: Props) {
  return (
    <div className="border-2 border-[#1A1A1A] bg-white">
      <div className="grid grid-cols-3 divide-x-2 divide-[#1A1A1A]">
        <Stat label="Games analyzed" value={String(gamesAnalyzed)} />
        <Stat label="Blunders found" value={String(blundersFound)} />
        <Stat
          label="Biggest swing"
          value={biggestSwing != null ? `${biggestSwing}%` : '—'}
          accent={biggestSwing != null}
        />
      </div>
      {opening && (
        <div className="border-t-2 border-[#1A1A1A] px-4 py-3 flex items-center justify-between gap-4">
          <span className="font-mono uppercase text-[10px] tracking-tight text-[#1A1A1A]/60">
            Opening
          </span>
          <span className="font-mono uppercase text-xs tracking-tight text-[#1A1A1A] truncate">
            {opening}
          </span>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="p-4 sm:p-6">
      <div className="font-mono uppercase text-[10px] tracking-tight text-[#1A1A1A]/60 mb-2">
        {label}
      </div>
      <div
        className={
          'font-mono text-2xl sm:text-3xl tracking-tight ' +
          (accent ? 'text-gold-dark' : 'text-[#1A1A1A]')
        }
      >
        {value}
      </div>
    </div>
  );
}
