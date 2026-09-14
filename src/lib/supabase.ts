import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../env';
import type { Database, Json } from './database.types';

type TypedClient = SupabaseClient<Database>;

/**
 * Cast a structured value into a `Json` DB column. The generated column type is
 * the opaque `Json` union; our typed payloads (CorrectMove[], solution lines,
 * annotation maps) are JSON-serializable but don't structurally satisfy the
 * union's index signature, so this is the one sanctioned assertion for writing
 * them — clearer than scattering `as unknown as Json` at every call site.
 */
export function toJson(value: unknown): Json {
  return value as Json;
}

// Lazily construct the client on first use rather than at import time. This
// keeps a misconfigured/missing env from hard-crashing app boot (a thrown
// `createClient('','')` would take down React before anything renders) — which
// matters for the static prerender of public routes, where the build env may
// not carry the Supabase vars and those pages never touch Supabase anyway.
let client: TypedClient | null = null;

function getClient(): TypedClient {
  if (!client) {
    // Fall back to inert placeholders when the env is missing so `createClient`
    // never throws (it rejects empty strings). Real deploys carry the vars; this
    // only keeps the static prerender of public routes — which make no Supabase
    // calls — from crashing the app during the build's headless render.
    const url = SUPABASE_URL || 'http://localhost:54321';
    const key = SUPABASE_ANON_KEY || 'public-anon-key-placeholder';
    client = createClient<Database>(url, key, {
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

export const supabase = new Proxy({} as TypedClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
}) as TypedClient;
