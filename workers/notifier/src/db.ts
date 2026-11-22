// Minimal Supabase REST client (PostgREST) with the service-role key. The
// Worker needs four calls, so it skips @supabase/supabase-js and its bundle.

export interface DbEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

async function request<T>(env: DbEnv, path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`supabase ${init.method ?? 'GET'} ${path.split('?')[0]} ${res.status}: ${body.slice(0, 300)}`);
  return (body ? JSON.parse(body) : null) as T;
}

export function rpc<T>(env: DbEnv, fn: string, args: Record<string, unknown>): Promise<T> {
  return request<T>(env, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
}

export function insert<T = unknown>(env: DbEnv, table: string, rows: unknown, returning = false): Promise<T> {
  return request<T>(env, table, {
    method: 'POST',
    body: JSON.stringify(rows),
    headers: { Prefer: returning ? 'return=representation' : 'return=minimal' },
  });
}

export function remove(env: DbEnv, table: string, filter: string): Promise<unknown> {
  return request(env, `${table}?${filter}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}
