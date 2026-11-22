import { rpc } from '../../lib/api';
import type { Tables } from '../../lib/database.types';

export interface BenchmarkRow {
  kind: string;
  bucket: string;
  value: number;
  sampleSize: number;
  source: string | null;
}

export async function getBenchmarks(kind?: string): Promise<BenchmarkRow[]> {
  const rows = await rpc<Tables<'benchmarks'>[]>('benchmarks.list', { kind: kind ?? null });
  return rows.map((row) => ({
    kind: row.kind,
    bucket: row.bucket,
    value: Number(row.value),
    sampleSize: row.sample_size,
    source: row.source ?? null,
  }));
}
