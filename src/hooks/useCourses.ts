import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { supabaseService, type CourseProgress } from '../services/supabaseService';
import { getGameStatRows } from '../services/db/statRows';
import { detectTimezone, localDate } from '../services/streakService';
import { costlyExitGames } from '../chess/openingDeviation';
import { classifyEndgameType, type EndgameType } from '../chess/endgameType';
import { recommendCourses, type CourseRecommendation, type OpeningStat } from '../lib/courseRecommend';
import { courseDrillPositions, type DrillGameMeta } from '../lib/courseDrill';
import type { Course } from '../lib/courseCatalog';
import { AVAILABLE_COURSES } from '../lib/courses';
import type { DayDone } from '../lib/coursePacing';
import type { Blunder } from '../models/blunder';
import { useOpeningInsight, useMotifInsight } from './useInsights';
import { useOpeningDeviations } from './useOpeningDeviations';
import { useEndgameScenarios } from './useEndgameScenarios';

export const COURSE_PROGRESS_KEY = ['courses', 'progress'] as const;

/** The player's local date (YYYY-MM-DD): pacing opens one new lesson per date. */
export function useCourseToday(): string {
  const { profile } = useAuth();
  return localDate(profile?.timezone ?? detectTimezone());
}

export function useCourseProgress(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...COURSE_PROGRESS_KEY, user?.id],
    queryFn: () => supabaseService.getCourseProgress(),
    enabled: !!user && enabled,
    staleTime: 60_000,
  });
}

export function useCompleteCourseDay() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { slug: string; day: number; localDate: string }) =>
      supabaseService.completeCourseDay(v.slug, v.day, v.localDate),
    onSuccess: (days: DayDone[], v) => {
      qc.setQueryData<CourseProgress>([...COURSE_PROGRESS_KEY, user?.id], (old) => {
        const byCourse = new Map(old?.byCourse ?? []);
        byCourse.set(v.slug, days);
        return { focus: old?.focus ?? null, byCourse };
      });
    },
  });
}

/** Follow a course (or `null` to stop); refreshes the profile so the plan and the ask see it. */
export function useSetCourseFocus() {
  const { user, refreshProfile } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string | null) => supabaseService.setCourseFocus(slug),
    onSuccess: async (focus) => {
      qc.setQueryData<CourseProgress>([...COURSE_PROGRESS_KEY, user?.id], (old) =>
        old ? { ...old, focus } : old,
      );
      await refreshProfile();
    },
  });
}

/** A supporter-only lesson's video segment + takeaway (enable only for supporters on an open day). */
export function useCourseDayContent(slug: string, day: number, today: string, enabled: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['courses', 'day', slug, day, user?.id],
    queryFn: () => supabaseService.getCourseDayContent(slug, day, today),
    enabled: !!user && enabled,
    staleTime: 60 * 60_000,
    retry: false,
  });
}

/** Tactic blunders per phase (shares the cached stat rows). */
function usePhaseCounts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['insights', 'phaseCounts', user?.id],
    queryFn: () => supabaseService.getBlunderPhaseCounts(),
    enabled: !!user,
    staleTime: 5 * 60_000,
  });
}

/** "Recommended for you": the top 3 available courses for this player's games. */
export function useCourseRecommendations(courses: readonly Course[] = AVAILABLE_COURSES): {
  recommendations: CourseRecommendation[];
  isPending: boolean;
} {
  const openings = useOpeningInsight();
  const deviations = useOpeningDeviations();
  const motifs = useMotifInsight();
  const phases = usePhaseCounts();
  const scenarios = useEndgameScenarios();
  const progress = useCourseProgress();

  const isPending = openings.isPending || motifs.isPending || phases.isPending;
  const recommendations = useMemo(() => {
    if (isPending || courses.length === 0) return [];
    const costly = new Map<string, number>();
    for (const s of deviations.data ?? []) costly.set(`${s.family}|${s.color}`, costlyExitGames(s));
    const openingStats: OpeningStat[] = (openings.data?.rows ?? []).map((r) => ({
      family: r.family,
      color: r.userColor,
      games: r.games,
      costlyExits: r.userColor ? (costly.get(`${r.family}|${r.userColor}`) ?? 0) : 0,
    }));
    let endgameTypeCounts: Partial<Record<EndgameType, number>> | undefined;
    if (scenarios.data && scenarios.data.length > 0) {
      endgameTypeCounts = {};
      for (const s of scenarios.data) {
        if (s.retiredAt) continue;
        const t = classifyEndgameType(s.startFen);
        endgameTypeCounts[t] = (endgameTypeCounts[t] ?? 0) + 1;
      }
    }
    const finished = new Set<string>();
    for (const c of courses) {
      if ((progress.data?.byCourse.get(c.slug)?.length ?? 0) >= c.days.length) finished.add(c.slug);
    }
    return recommendCourses(courses, {
      openings: openingStats,
      motifCounts: motifs.data?.counts ?? {},
      phaseCounts: phases.data ?? { opening: 0, middlegame: 0, endgame: 0 },
      endgameTypeCounts,
      finished,
    });
  }, [isPending, courses, deviations.data, openings.data, scenarios.data, progress.data, motifs.data, phases.data]);

  return { recommendations, isPending };
}

/** Today's drill for a course: matching positions from your own live blunders. */
export function useCourseDrill(course: Course | null): { positions: Blunder[]; isPending: boolean } {
  const { user } = useAuth();
  const blunders = useQuery({
    // Same key as the Vault's list, so the two share one fetch.
    queryKey: ['blunders', 'vault', user?.id],
    queryFn: () => supabaseService.getAllLiveBlunders(),
    enabled: !!user && !!course,
    staleTime: 60_000,
  });
  const games = useQuery({
    queryKey: ['courses', 'gameMeta', user?.id],
    queryFn: async () => {
      const rows = await getGameStatRows(user!.id);
      const out = new Map<string, DrillGameMeta>();
      for (const g of rows) {
        out.set(g.id, {
          family: g.opening_family,
          color: g.user_color === 'white' || g.user_color === 'black' ? g.user_color : null,
        });
      }
      return out;
    },
    enabled: !!user && course?.topic.type === 'opening',
    staleTime: 2 * 60_000,
  });
  const needsGames = course?.topic.type === 'opening';
  const isPending = !!course && (blunders.isPending || (needsGames && games.isPending));
  const positions = useMemo(
    () => (course && !isPending ? courseDrillPositions(course, blunders.data ?? [], games.data ?? new Map()) : []),
    [course, isPending, blunders.data, games.data],
  );
  return { positions, isPending };
}
