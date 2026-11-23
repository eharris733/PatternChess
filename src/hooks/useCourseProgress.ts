import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { getCourseProgress } from '../services/db/courses';
import { AVAILABLE_COURSES } from '../lib/courses';

// Kept apart from useCourses.ts on purpose: AppShell reaches this through
// useNextAsk, and useCourses pulls in the insight and openings-scan modules,
// which must stay out of the entry chunk (a static import from there made the
// production build's openings-scan chunk initialise before its dependencies).

export const COURSE_PROGRESS_KEY = ['courses', 'progress'] as const;

/** Finished lessons + the followed course. Off when this build has no courses (production until permissions land). */
export function useCourseProgress(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...COURSE_PROGRESS_KEY, user?.id],
    queryFn: () => getCourseProgress(),
    enabled: !!user && enabled && AVAILABLE_COURSES.length > 0,
    staleTime: 60_000,
  });
}
