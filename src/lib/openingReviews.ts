import { authService } from '../services/authService';

/**
 * Count one opening review (`profiles.opening_reviews_opened`, backing the
 * "First Look" / "Case Study" achievements): starting opening drills from
 * /openings. Fire-and-forget; `onCounted` refreshes the profile so the
 * achievement can unlock without a reload.
 */
export function recordOpeningReview(onCounted?: () => void): void {
  void authService
    .incrementOpeningReviews()
    .then(() => onCounted?.())
    .catch((err) => console.warn('[openings] count review failed', err));
}
