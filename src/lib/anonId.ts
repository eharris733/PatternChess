// Stable per-browser visitor id, generated on first landing and persisted in
// localStorage so it survives the OAuth redirect (same origin) and links an
// anonymous visitor to the account they eventually create. Best-effort: returns
// '' if storage is unavailable (private mode), in which case tracking no-ops.
const KEY = 'pc_anon_id';

export function getAnonId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}
