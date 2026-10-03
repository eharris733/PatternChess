import { supabase } from '../../lib/supabase';

// The signed-in user's id, mirrored from AuthProvider's session (initial
// getSession + every onAuthStateChange). `undefined` = not known yet.
let cachedUserId: string | null | undefined;
let inflight: Promise<string | null> | null = null;

/** Called by AuthProvider whenever the session changes (null on sign-out). */
export function setCachedUserId(id: string | null): void {
  cachedUserId = id;
}

export async function currentUserId(): Promise<string | null> {
  // This helper runs at the top of ~every service method. Every
  // supabase.auth.getSession()/getUser() call queues on gotrue's Web Lock, so
  // calling it per query piled dozens of waiters behind one lock; when a token
  // refresh stalled, they sat past the 5s timeout and gotrue "stole" the lock,
  // aborting in-flight work (the openings scan, the maintenance worker). Read
  // the id AuthProvider already holds instead, and only fall back to one
  // shared getSession() before it has loaded. The id is only attached as
  // user_id on client writes and filters; RLS enforces auth.uid() server-side,
  // so a cached (vs server-verified) id is safe here.
  if (cachedUserId !== undefined) return cachedUserId;
  inflight ??= supabase.auth
    .getSession()
    .then(({ data }) => {
      const id = data.session?.user?.id ?? null;
      // A session event may have landed while this was waiting; it wins.
      if (cachedUserId === undefined) cachedUserId = id;
      return cachedUserId;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
