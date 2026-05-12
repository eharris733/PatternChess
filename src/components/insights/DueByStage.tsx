import clsx from 'clsx';
import { Blunder, SR_BUCKET_LABEL, SR_BUCKET_ORDER, SrBucket, srBucket } from '../../models/blunder';

export function DueByStage({ data }: { data: Blunder[] }) {
  const counts = new Map<SrBucket, number>();
  for (const b of data) {
    const bucket = srBucket(b);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {SR_BUCKET_ORDER.map((bucket) => {
        const count = counts.get(bucket) ?? 0;
        const empty = count === 0;
        return (
          <span
            key={bucket}
            className={clsx(
              'inline-flex items-baseline gap-1 px-2 py-0.5 rounded-md bg-surface-2 text-xs',
              empty ? 'text-text-secondary opacity-40' : 'text-text-primary',
            )}
          >
            <span className="font-mono font-semibold">{count}</span>
            <span className="text-text-secondary">{SR_BUCKET_LABEL[bucket]}</span>
          </span>
        );
      })}
    </div>
  );
}
