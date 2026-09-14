import { supabase } from '../../lib/supabase';

export interface BenchmarkRow {
  kind: string;
  bucket: string;
  value: number;
  sampleSize: number;
  source: string | null;
}

export async function getBenchmarks(kind?: string): Promise<BenchmarkRow[]> {
  let q = supabase.from('benchmarks').select();
  if (kind) q = q.eq('kind', kind);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((row) => ({
    kind: row.kind,
    bucket: row.bucket,
    value: Number(row.value),
    sampleSize: row.sample_size,
    source: row.source ?? null,
  }));
}
