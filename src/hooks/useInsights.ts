import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import {
  PhaseCounts,
  MotifCounts,
  OpeningGroupRow,
  TimeManagementSample,
  GameStateStats,
  TimeTroubleStats,
  supabaseService,
} from '../services/supabaseService';
import {
  loadBenchmarks,
  lookupBenchmark,
  ratingBand,
} from '../services/benchmarkService';

export interface PhaseInsight {
  counts: PhaseCounts;
  benchmark: { opening: number; middlegame: number; endgame: number } | null;
  band: ReturnType<typeof ratingBand>;
  benchmarkSampleSize: number | null;
  benchmarkSource: string | null;
}

export function usePhaseBlunderInsight() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['insights', 'phase', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<PhaseInsight> => {
      const [counts, set, meanRating] = await Promise.all([
        supabaseService.getBlunderPhaseCounts(),
        loadBenchmarks(),
        supabaseService.getUserRatingMean(),
      ]);
      const band = ratingBand(meanRating);
      const open = lookupBenchmark(set, 'phase_blunder_rate', `opening:${band}`);
      const mid = lookupBenchmark(set, 'phase_blunder_rate', `middlegame:${band}`);
      const end = lookupBenchmark(set, 'phase_blunder_rate', `endgame:${band}`);
      const benchmark = open && mid && end
        ? { opening: open.value, middlegame: mid.value, endgame: end.value }
        : null;
      const benchmarkSampleSize = open?.sampleSize ?? null;
      return {
        counts,
        benchmark,
        band,
        benchmarkSampleSize,
        benchmarkSource: set.sources.phase_blunder_rate ?? null,
      };
    },
  });
}

export function useMotifInsight() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['insights', 'motifs', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<MotifCounts> => supabaseService.getBlunderMotifCounts(),
  });
}

export interface OpeningInsightRow extends OpeningGroupRow {
  winRate: number;
  blunderRate: number;
}

export interface OpeningInsight {
  rows: OpeningInsightRow[];
  band: ReturnType<typeof ratingBand>;
  totalGames: number;
}

export const MIN_TOTAL_GAMES_FOR_OPENING = 10;

export function useOpeningInsight() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['insights', 'opening', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<OpeningInsight> => {
      const [groups, meanRating] = await Promise.all([
        supabaseService.getOpeningPerformance(),
        supabaseService.getUserRatingMean(),
      ]);
      const band = ratingBand(meanRating);
      const totalGames = groups.reduce((acc, g) => acc + g.games, 0);
      // All rows — the card decides how many to show (top 3 + "show all").
      const rows: OpeningInsightRow[] = groups.map((g) => ({
        ...g,
        winRate: g.games > 0 ? (g.wins + 0.5 * g.draws) / g.games : 0,
        blunderRate: g.games > 0 ? g.blunders / g.games : 0,
      }));
      return { rows, band, totalGames };
    },
  });
}

export interface TimeManagementInsight {
  samples: TimeManagementSample[];
}

export function useTimeManagementInsight() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['insights', 'timeManagement', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<TimeManagementInsight> => {
      const samples = await supabaseService.getUserTimeManagement();
      return { samples };
    },
  });
}

export function useTimeTroubleInsight() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['insights', 'timeTrouble', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<TimeTroubleStats> => supabaseService.getTimeTroubleStats(),
  });
}

export function useGameStateInsight() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['insights', 'gameState', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<GameStateStats> => supabaseService.getBlunderGameStateStats(),
  });
}
