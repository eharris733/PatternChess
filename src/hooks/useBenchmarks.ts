import { useQuery } from '@tanstack/react-query';
import { loadBenchmarks } from '../services/benchmarkService';

export function useBenchmarks() {
  return useQuery({
    queryKey: ['benchmarks', 'v1'],
    queryFn: loadBenchmarks,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
