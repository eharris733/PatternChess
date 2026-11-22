/**
 * Client for the Pages Functions RPC endpoint: POST /api/rpc/:name with the
 * args object as JSON → `{ data }` | `{ error: { code, message } }`.
 * Same-origin, so the better-auth session cookie rides along.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

export async function rpc<T = unknown>(name: string, args: object = {}, init: { signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/rpc/${encodeURIComponent(name)}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: init.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'network', e instanceof Error ? e.message : 'Network error');
  }
  let body: { data?: unknown; error?: { code?: string; message?: string } } | null = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok || !body || body.error) {
    const code = body?.error?.code ?? (res.ok ? 'bad_response' : `http_${res.status}`);
    const message = body?.error?.message ?? `RPC ${name} failed (${res.status})`;
    throw new ApiError(res.ok ? 500 : res.status, code, message);
  }
  return (body.data ?? null) as T;
}
