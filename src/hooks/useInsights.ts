import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import {
  PhaseCounts,
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

interface RatingMean {
  meanRating: number | null;
  rated: boolean;
}

async function fetchUserRatingMean(): Promise<RatingMean> {
  const games = await supabaseService.getGames();
  const rated = games.filter((g) => g.rated && typeof g.userRating === 'number');
  if (rated.length === 0) return { meanRating: null, rated: false };
  const sum = rated.reduce((acc, g) => acc + (g.userRating ?? 0), 0);
  return { meanRating: Math.round(sum / rated.length), rated: true };
}

function useUserRatingMean() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['user', 'ratingMean', user?.id],
    queryFn: fetchUserRatingMean,
    enabled: !!user,
    staleTime: 60_000,
  });
}

export interface PhaseInsight {
  counts: PhaseCounts;
  benchmark: { opening: number; middlegame: number; endgame: number } | null;
  band: ReturnType<typeof ratingBand>;
  benchmarkSampleSize: number | null;
  benchmarkSource: string | null;
}

export function usePhaseBlunderInsight() {
  const { user } = useAuth();
  const ratingMean = useUserRatingMean();

  return useQuery({
    queryKey: ['insights', 'phase', user?.id, ratingMean.data?.meanRating],
    enabled: !!user && ratingMean.isFetched,
    queryFn: async (): Promise<PhaseInsight> => {
      const [counts, set] = await Promise.all([
        supabaseService.getBlunderPhaseCounts(),
        loadBenchmarks(),
      ]);
      const band = ratingBand(ratingMean.data?.meanRating ?? null);
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
  const ratingMean = useUserRatingMean();

  return useQuery({
    queryKey: ['insights', 'opening', user?.id, ratingMean.data?.meanRating],
    enabled: !!user && ratingMean.isFetched,
    queryFn: async (): Promise<OpeningInsight> => {
      const groups = await supabaseService.getOpeningPerformance();
      const band = ratingBand(ratingMean.data?.meanRating ?? null);
      const totalGames = groups.reduce((acc, g) => acc + g.games, 0);
      const top = groups.slice(0, 3);
      const rows: OpeningInsightRow[] = top.map((g) => ({
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
