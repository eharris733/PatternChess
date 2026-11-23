import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { supabaseService, type CourseProgress } from '../services/supabaseService';
import { getGameStatRows } from '../services/db/statRows';
import { detectTimezone, localDate } from '../services/streakService';
import { costlyExitGames } from '../chess/openingDeviation';
import { classifyEndgameType, type EndgameType } from '../chess/endgameType';
import { recommendCourses, type CourseRecommendation, type OpeningStat } from '../lib/courseRecommend';
import { courseDrillPositions, matchCourseBlunders, type DrillGameMeta } from '../lib/courseDrill';
import { loadLesson } from '../lib/courseLessons';
import type { Course } from '../lib/courseCatalog';
import { AVAILABLE_COURSES } from '../lib/courses';
import type { DayDone } from '../lib/coursePacing';
import type { Blunder } from '../models/blunder';
import { useOpeningInsight, useMotifInsight } from './useInsights';
import { useOpeningDeviations } from './useOpeningDeviations';
import { useEndgameScenarios } from './useEndgameScenarios';

export const COURSE_PROGRESS_KEY = ['courses', 'progress'] as const;

/** The player's local date (YYYY-MM-DD), stored with each finished lesson for the plan's lesson step. */
export function useCourseToday(): string {
  const { profile } = useAuth();
  return localDate(profile?.timezone ?? detectTimezone());
}

/** Finished lessons + the followed course. Off when this build has no courses (production until permissions land). */
export function useCourseProgress(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...COURSE_PROGRESS_KEY, user?.id],
    queryFn: () => supabaseService.getCourseProgress(),
    enabled: !!user && enabled && AVAILABLE_COURSES.length > 0,
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

/** Follow a course (or `null` to stop); the plan and the dashboard ask read it from the progress query. */
export function useSetCourseFocus() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string | null) => supabaseService.setCourseFocus(slug),
    onSuccess: (focus) => {
      qc.setQueryData<CourseProgress>([...COURSE_PROGRESS_KEY, user?.id], (old) => ({
        focus,
        byCourse: old?.byCourse ?? new Map(),
      }));
    },
  });
}

/** A supporter-only lesson's video segment + takeaway (enable only for supporters on an open day). */
export function useCourseDayContent(slug: string, day: number, enabled: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['courses', 'day', slug, day, user?.id],
    queryFn: () => supabaseService.getCourseDayContent(slug, day),
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

/** A day's interactive lesson (src/generated/courses/<slug>.json), or null for a watch-only day. */
export function useCourseLesson(slug: string | null | undefined) {
  return useQuery({
    queryKey: ['courses', 'lesson', slug],
    queryFn: () => loadLesson(slug!),
    enabled: !!slug,
    staleTime: Infinity,
  });
}

/**
 * "Now your games": every live position from your own games that matches the
 * course topic (`total`) and the ones to drill now (`positions`, up to
 * COURSE_DRILL_SIZE, the most useful first).
 */
export function useCourseDrill(course: Course | null): { positions: Blunder[]; total: number; isPending: boolean } {
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
  const { positions, total } = useMemo(() => {
    if (!course || isPending) return { positions: [] as Blunder[], total: 0 };
    const meta = games.data ?? new Map<string, DrillGameMeta>();
    return {
      positions: courseDrillPositions(course, blunders.data ?? [], meta),
      total: matchCourseBlunders(course, blunders.data ?? [], meta).length,
    };
  }, [course, isPending, blunders.data, games.data]);
  return { positions, total, isPending };
}
