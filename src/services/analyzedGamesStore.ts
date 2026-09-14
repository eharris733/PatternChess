// Per-user, per-browser record of which games the user has opened for external
// analysis (Lichess/Chess.com). Lives only in localStorage — a convenience flag
// that flips the vault's "Analyze" link to "Re-analyze"; never synced or read
// back by the server.

export const ANALYZED_STORAGE_PREFIX = 'pc:analyzed-externally:';

export function loadAnalyzedSet(userId: string | null | undefined): Set<string> {
  if (!userId) return new Set();
  try {
    const raw = localStorage.getItem(ANALYZED_STORAGE_PREFIX + userId);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr as string[]) : new Set();
  } catch {
    return new Set();
  }
}

export function persistAnalyzedSet(userId: string, set: Set<string>): void {
  try {
    localStorage.setItem(ANALYZED_STORAGE_PREFIX + userId, JSON.stringify([...set]));
  } catch {
    // localStorage unavailable — silently ignore
  }
}
