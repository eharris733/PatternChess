// After a deploy, a tab still running the previous build asks for hashed
// route chunks (assets/OpeningsRoute-<hash>.js) that no longer exist. The SPA
// fallback answers with index.html, so the dynamic import fails with a MIME
// error and the route crashes into the ErrorBoundary. Reloading once picks up
// the new build. A short window in sessionStorage stops a reload loop when the
// chunk is genuinely broken — then the normal error card shows.

const RELOAD_KEY = 'pc:stale-chunk-reload-at';
const LOOP_WINDOW_MS = 30_000;

let reloading = false;

export function isChunkLoadError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(
      err.message,
    )
  );
}

/** True while a reload for a stale chunk is underway. */
export function isReloadingForStaleChunk(): boolean {
  return reloading;
}

/**
 * Reload to fetch the new build, unless we already did so moments ago.
 * Returns whether a reload was started (or is already underway).
 */
export function reloadForStaleChunk(): boolean {
  if (reloading) return true;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < LOOP_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // No storage: can't guard against a loop, so don't auto-reload.
    return false;
  }
  reloading = true;
  window.location.reload();
  return true;
}

/** Vite fires this when a dynamic import or its preloads fail. */
export function installStaleChunkReload(): void {
  window.addEventListener('vite:preloadError', () => {
    reloadForStaleChunk();
  });
}
