export interface BenchmarkEntry {
  kind: string;
  bucket: string;
  value: number;
  sampleSize: number;
}

export interface BenchmarkSet {
  version: number;
  sources: Record<string, string>;
  byKey: Map<string, BenchmarkEntry>;
}

let cached: Promise<BenchmarkSet> | null = null;

interface RawBenchmarkRow {
  kind: string;
  bucket: string;
  value: number;
  sample_size: number;
}

interface RawBenchmarkFile {
  version: number;
  sources: Record<string, string>;
  data: RawBenchmarkRow[];
}

async function fetchBenchmarks(): Promise<BenchmarkSet> {
  const res = await fetch('/benchmarks/v1.json', { cache: 'force-cache' });
  if (!res.ok) throw new Error(`Failed to load benchmarks: ${res.status}`);
  const json = (await res.json()) as RawBenchmarkFile;
  const byKey = new Map<string, BenchmarkEntry>();
  for (const row of json.data) {
    byKey.set(`${row.kind}:${row.bucket}`, {
      kind: row.kind,
      bucket: row.bucket,
      value: row.value,
      sampleSize: row.sample_size,
    });
  }
  return { version: json.version, sources: json.sources, byKey };
}

export function loadBenchmarks(): Promise<BenchmarkSet> {
  if (!cached) cached = fetchBenchmarks();
  return cached;
}

export function lookupBenchmark(set: BenchmarkSet, kind: string, bucket: string): BenchmarkEntry | null {
  return set.byKey.get(`${kind}:${bucket}`) ?? null;
}

/** Map a numeric rating to one of the seeded buckets. */
export function ratingBand(rating: number | null | undefined): '<1400' | '1400-1799' | '1800-2199' | '2200+' {
  if (!rating || !Number.isFinite(rating) || rating < 1400) return '<1400';
  if (rating < 1800) return '1400-1799';
  if (rating < 2200) return '1800-2199';
  return '2200+';
}
