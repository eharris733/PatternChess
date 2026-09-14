import { supabase, toJson } from '../../lib/supabase';
import type { ExplorerResult } from '../openingExplorerService';

export async function getCachedExplorerResult(fen: string): Promise<ExplorerResult | null> {
  const { data, error } = await supabase
    .from('opening_explorer_cache')
    .select()
    .eq('fen', fen)
    .maybeSingle();
  if (error) return null;
  return data?.result ? (data.result as unknown as ExplorerResult) : null;
}

export async function cacheExplorerResult(fen: string, result: ExplorerResult): Promise<void> {
  await supabase.from('opening_explorer_cache').upsert({ fen, result: toJson(result) });
}
