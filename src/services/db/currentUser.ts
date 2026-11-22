import { authClient } from '../../lib/authClient';

// The signed-in user's id, mirrored from AuthProvider's better-auth session.
// `undefined` = not known yet. The server never trusts it: every RPC scopes by
// the session cookie's user.
let cachedUserId: string | null | undefined;
let inflight: Promise<string | null> | null = null;

/** Called by AuthProvider whenever the session changes (null on sign-out). */
export function setCachedUserId(id: string | null): void {
  cachedUserId = id;
}

export async function currentUserId(): Promise<string | null> {
  // Runs at the top of ~every service method: read the id AuthProvider
  // already holds, and only fall back to one shared get-session call before it
  // has loaded.
  if (cachedUserId !== undefined) return cachedUserId;
  inflight ??= authClient
    .getSession()
    .then(({ data }) => {
      const id = data?.user?.id ?? null;
      // A session event may have landed while this was waiting; it wins.
      if (cachedUserId === undefined) cachedUserId = id;
      return cachedUserId;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
