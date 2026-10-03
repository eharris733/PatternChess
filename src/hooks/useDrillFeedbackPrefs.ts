import { create } from 'zustand';
import { useAuth } from '../auth/useAuth';
import { authService } from '../services/authService';

/**
 * The two post-miss drill-feedback settings, shared by every drill surface
 * (/training tactics, queue endgames, /endgames, and anything added later):
 *
 * - `showAnswer` (`profiles.show_answer_on_miss`): after a wrong attempt, draw
 *   the best move and offer the solution line.
 * - `autoplay` (`profiles.autoplay_refutation`): after a wrong attempt, play
 *   the refutation of the played move on the board — then the solution, when
 *   `showAnswer` is on. Use `useLineAutoplay` to run it.
 *
 * Toggled from the gear (`DrillSettingsMenu`) and /profile. Writes are
 * optimistic through a module-level override so every mounted reader flips
 * together; the override clears once the refreshed profile carries the value,
 * or reverts on a failed write.
 */
type PrefKey = 'showAnswer' | 'autoplay';

interface OverrideState {
  overrides: Partial<Record<PrefKey, boolean>>;
  error: string | null;
}

const useOverrides = create<OverrideState>(() => ({ overrides: {}, error: null }));

const clearOverride = (key: PrefKey, value: boolean) =>
  useOverrides.setState((s) => {
    // A newer toggle has already replaced this write; leave its override.
    if (s.overrides[key] !== value) return s;
    const next = { ...s.overrides };
    delete next[key];
    return { overrides: next };
  });

export function useDrillFeedbackPrefs() {
  const { profile, refreshProfile } = useAuth();
  const overrides = useOverrides((s) => s.overrides);
  const error = useOverrides((s) => s.error);

  const showAnswer = overrides.showAnswer ?? profile?.showAnswerOnMiss ?? false;
  const autoplay = overrides.autoplay ?? profile?.autoplayRefutation ?? true;

  const write = (key: PrefKey, value: boolean) => {
    if (!profile) return;
    useOverrides.setState((s) => ({ overrides: { ...s.overrides, [key]: value }, error: null }));
    const patch =
      key === 'showAnswer' ? { showAnswerOnMiss: value } : { autoplayRefutation: value };
    void authService
      .updateTrainingPrefs(profile.id, patch)
      .then(() => refreshProfile())
      .then(() => clearOverride(key, value))
      .catch((err) => {
        console.warn('[drill-prefs] persist failed', err);
        clearOverride(key, value);
        useOverrides.setState({
          error:
            'Could not save this preference. If this keeps happening, the latest profiles migration may not be applied yet.',
        });
      });
  };

  return {
    showAnswer,
    autoplay,
    error,
    setShowAnswer: (v: boolean) => write('showAnswer', v),
    setAutoplay: (v: boolean) => write('autoplay', v),
  };
}
