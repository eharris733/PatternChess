import { create } from 'zustand';

interface OnboardingState {
  // Latched once the gate has decided to show the onboarding screen for this
  // session — prevents flipping back to the route mid-import once games start
  // landing in the DB. Cleared only by `dismiss()` (user clicks "Continue")
  // or `reset()` (sign-out).
  active: boolean;
  // Whether the user has explicitly clicked through onboarding this session.
  dismissed: boolean;
  setActive: () => void;
  dismiss: () => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  active: false,
  dismissed: false,
  setActive: () => set({ active: true }),
  dismiss: () => set({ active: false, dismissed: true }),
  reset: () => set({ active: false, dismissed: false }),
}));
