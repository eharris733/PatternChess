/**
 * Work that must not outlive the signed-in user: background jobs that keep
 * running on any page (the detached openings scan) register here, and
 * AuthProvider runs every hook on sign-out or an account switch. A module
 * registers when it loads, so code that was never imported has nothing to stop.
 */

const hooks = new Set<() => void>();

export function onSessionEnd(hook: () => void): () => void {
  hooks.add(hook);
  return () => {
    hooks.delete(hook);
  };
}

export function runSessionEndHooks(): void {
  for (const hook of hooks) {
    try {
      hook();
    } catch (e) {
      console.warn('[session] end hook failed', e);
    }
  }
}
