import { Blunder, SR_BUCKET_LABEL, SR_BUCKET_ORDER, SrBucket, srBucket } from '../../models/blunder';

export function DueByStage({ data }: { data: Blunder[] }) {
  const counts = new Map<SrBucket, number>();
  for (const b of data) {
    const bucket = srBucket(b);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  const visible = SR_BUCKET_ORDER.filter((b) => (counts.get(b) ?? 0) > 0);
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((bucket) => (
        <span
          key={bucket}
          className="inline-flex items-baseline gap-1 px-2 py-0.5 rounded-md bg-surface-2 text-xs text-text-primary"
        >
          <span className="font-mono font-semibold">{counts.get(bucket)}</span>
          <span className="text-text-secondary">{SR_BUCKET_LABEL[bucket]}</span>
        </span>
      ))}
    </div>
  );
}
