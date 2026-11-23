import { create } from 'zustand';

interface OnboardingState {
  // Latched once the gate has decided to show the onboarding screen for this
  // session — prevents flipping back to the route mid-import once games start
  // landing in the DB. Cleared only by `dismiss()` (user clicks "Continue")
  // or `reset()` (sign-out).
  active: boolean;
  // Whether the user has explicitly clicked through onboarding this session.
  dismissed: boolean;
  /**
   * The address just typed into the Lichess email step. Keeps the step on
   * screen ("check your inbox") after the profile stops needing it, until
   * the player clicks Continue.
   */
  savedEmail: string | null;
  setActive: () => void;
  dismiss: () => void;
  setSavedEmail: (email: string | null) => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  active: false,
  dismissed: false,
  savedEmail: null,
  setActive: () => set({ active: true }),
  dismiss: () => set({ active: false, dismissed: true }),
  setSavedEmail: (email) => set({ savedEmail: email }),
  reset: () => set({ active: false, dismissed: false, savedEmail: null }),
}));
