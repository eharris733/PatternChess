import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../env';

// Lazily construct the client on first use rather than at import time. This
// keeps a misconfigured/missing env from hard-crashing app boot (a thrown
// `createClient('','')` would take down React before anything renders) — which
// matters for the static prerender of public routes, where the build env may
// not carry the Supabase vars and those pages never touch Supabase anyway.
let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!client) {
    // Fall back to inert placeholders when the env is missing so `createClient`
    // never throws (it rejects empty strings). Real deploys carry the vars; this
    // only keeps the static prerender of public routes — which make no Supabase
    // calls — from crashing the app during the build's headless render.
    const url = SUPABASE_URL || 'http://localhost:54321';
    const key = SUPABASE_ANON_KEY || 'public-anon-key-placeholder';
    client = createClient(url, key, {
      auth: {
        flowType: 'pkce',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }
  return client;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
}) as SupabaseClient;
