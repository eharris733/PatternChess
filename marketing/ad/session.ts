// Mints a real Supabase session for the ad account without the OAuth dance:
// admin.generateLink (service key, Node only) → verifyOtp with the hashed token.
// generateLink does not send an email.
import { createClient, type Session } from '@supabase/supabase-js';
import { AD_EMAIL, loadEnv } from './env.ts';

export async function mintSession(): Promise<{ session: Session; storageKey: string }> {
  const env = loadEnv();
  const url = env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY missing from .env.local');

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email: AD_EMAIL });
  if (linkErr) throw linkErr;

  const anon = createClient(url, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token });
  if (error || !data.session) throw error ?? new Error('verifyOtp returned no session');

  const ref = new URL(url).hostname.split('.')[0];
  return { session: data.session, storageKey: `sb-${ref}-auth-token` };
}
