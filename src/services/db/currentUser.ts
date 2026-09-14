import { supabase } from '../../lib/supabase';

export async function currentUserId(): Promise<string | null> {
  // Read the locally cached session rather than getUser(): getUser() is a
  // network round-trip to /auth/v1/user held under the gotrue Web Lock, and
  // this helper runs at the top of ~every service method. Doing it per call
  // serialized dozens of queries behind one lock (slow loads) and, when the
  // auth endpoint stalled, held the lock past its 5s timeout — gotrue then
  // "steals" it, aborting in-flight writes (the maintenance worker,
  // endActiveSession). getSession() reads storage locally. The id is only
  // attached as user_id on client writes; RLS enforces auth.uid() server-side,
  // so a cached (vs server-verified) id is safe here.
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}
