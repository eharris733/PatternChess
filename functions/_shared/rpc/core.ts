import type { AppEnv } from '../db';
import type { SessionUser } from '../auth';

/**
 * RPC core: types, errors and the dispatcher behind POST /api/rpc/:name.
 * Domain modules (`./<domain>.ts`) import from here — never from ./index —
 * and export `handlers: RpcRegistry`; ./index merges them.
 */

export type RpcAuth = 'user' | 'admin' | 'public';

export interface RpcContext<U extends SessionUser | null = SessionUser | null> {
  /** The app D1 database (env.DB). */
  db: D1Database;
  env: AppEnv;
  /** The signed-in user (non-null for 'user'/'admin' handlers; may be null for 'public'). */
  user: U;
  request: Request;
  /** Keep work running after the response (Pages `waitUntil`). */
  waitUntil: (promise: Promise<unknown>) => void;
}

/** Context for 'user' / 'admin' handlers: `ctx.user` is guaranteed. */
export type UserRpcContext = RpcContext<SessionUser>;

export interface RpcDef {
  auth: RpcAuth;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (ctx: any, args: any) => Promise<unknown>;
}

export type RpcRegistry = Record<string, RpcDef>;

/** A signed-in user's handler. Scope every query by `ctx.user.id` (this replaces RLS). */
export function userRpc<A = Record<string, never>, R = unknown>(
  handler: (ctx: UserRpcContext, args: A) => Promise<R>,
): RpcDef {
  return { auth: 'user', handler };
}

/** Admin-only (email in ADMIN_EMAILS). */
export function adminRpc<A = Record<string, never>, R = unknown>(
  handler: (ctx: UserRpcContext, args: A) => Promise<R>,
): RpcDef {
  return { auth: 'admin', handler };
}

/** Anyone, signed in or not (`ctx.user` is filled when a session cookie is present). */
export function publicRpc<A = Record<string, never>, R = unknown>(
  handler: (ctx: RpcContext, args: A) => Promise<R>,
): RpcDef {
  return { auth: 'public', handler };
}

/** Throw from a handler to answer with a specific status + code. */
export class RpcError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export const badRequest = (message: string, code = 'bad_request') => new RpcError(400, code, message);
export const notFound = (message = 'Not found', code = 'not_found') => new RpcError(404, code, message);
export const forbidden = (message = 'Forbidden', code = 'forbidden') => new RpcError(403, code, message);
export const conflict = (message: string, code = 'conflict') => new RpcError(409, code, message);
export const tooManyRequests = (message = 'Too many requests', code = 'rate_limited') => new RpcError(429, code, message);

// --- argument helpers (throw 400 on a bad shape) ---------------------------

export function argString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string') throw badRequest(`${key} must be a string`);
  return v;
}

export function argOptString(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw badRequest(`${key} must be a string`);
  return v;
}

export function argNumber(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw badRequest(`${key} must be a number`);
  return v;
}

export function argBool(args: Record<string, unknown>, key: string): boolean {
  const v = args[key];
  if (typeof v !== 'boolean') throw badRequest(`${key} must be a boolean`);
  return v;
}

export function argStringArray(args: Record<string, unknown>, key: string, max = 10_000): string[] {
  const v = args[key];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw badRequest(`${key} must be a string[]`);
  if (v.length > max) throw badRequest(`${key} has more than ${max} items`);
  return v as string[];
}

// --- responses ---------------------------------------------------------------

// Function responses don't get public/_headers — keep the page isolated.
export const ISOLATION_HEADERS: Record<string, string> = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/** Same response with `Cache-Control: private, no-store` + the isolation headers. */
export function withApiHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'private, no-store');
  for (const [k, v] of Object.entries(ISOLATION_HEADERS)) out.headers.set(k, v);
  return out;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return withApiHeaders(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

export function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message } }, status);
}

// --- dispatch ----------------------------------------------------------------

export interface DispatchDeps {
  registry: RpcRegistry;
  getUser: (request: Request, env: AppEnv) => Promise<SessionUser | null>;
  isAdmin: (user: SessionUser) => boolean;
}

/** Cookie names better-auth uses for the session (plain + __Secure- prefixed). */
function hasSessionCookie(request: Request): boolean {
  return (request.headers.get('cookie') ?? '').includes('better-auth.session_token');
}

/**
 * Cross-site requests are refused: SameSite=Lax already keeps cookies off
 * cross-site fetches, and requiring a same-origin Origin (when sent) plus a
 * JSON content type closes the top-level form-POST hole.
 */
function crossSite(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const host = request.headers.get('host') ?? new URL(request.url).host;
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export async function dispatchRpc(
  name: string,
  request: Request,
  env: AppEnv,
  waitUntil: (p: Promise<unknown>) => void,
  deps: DispatchDeps,
): Promise<Response> {
  if (request.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Use POST');
  const def = Object.prototype.hasOwnProperty.call(deps.registry, name) ? deps.registry[name] : undefined;
  if (!def) return errorResponse(404, 'unknown_rpc', `Unknown RPC "${name}"`);
  if (crossSite(request)) return errorResponse(403, 'cross_site', 'Cross-site request refused');

  let args: Record<string, unknown> = {};
  const text = await request.text();
  if (text.trim()) {
    const ct = request.headers.get('content-type') ?? '';
    if (!ct.toLowerCase().includes('application/json')) {
      return errorResponse(415, 'unsupported_media_type', 'Send application/json');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return errorResponse(400, 'bad_json', 'Body is not valid JSON');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return errorResponse(400, 'bad_args', 'Body must be a JSON object of arguments');
    }
    args = parsed as Record<string, unknown>;
  }

  let user: SessionUser | null = null;
  if (def.auth !== 'public' || hasSessionCookie(request)) {
    user = await deps.getUser(request, env);
  }
  if (def.auth !== 'public' && !user) return errorResponse(401, 'unauthorized', 'Sign in required');
  if (def.auth === 'admin' && !deps.isAdmin(user!)) return errorResponse(403, 'forbidden', 'Admins only');

  const ctx: RpcContext = { db: env.DB, env, user, request, waitUntil };
  try {
    const data = await def.handler(ctx, args);
    return jsonResponse({ data: data === undefined ? null : data });
  } catch (e) {
    if (e instanceof RpcError) return errorResponse(e.status, e.code, e.message);
    console.error(`[rpc] ${name} failed`, e instanceof Error ? e.stack ?? e.message : e);
    // Counted per hour for the notifier's alert check (workers/notifier/src/alerts.ts).
    waitUntil(countRpcError(env.DB, name).catch(() => undefined));
    return errorResponse(500, 'internal', 'Something went wrong');
  }
}

/** `YYYY-MM-DDTHH` (UTC) — the rpc_errors bucket for `at`. */
export function errorHour(at: Date = new Date()): string {
  return at.toISOString().slice(0, 13);
}

/** +1 unexpected failure for `name` this hour (rpc_errors, migration 0007). */
export async function countRpcError(db: D1Database | undefined, name: string, at: Date = new Date()): Promise<void> {
  if (!db) return;
  await db
    .prepare(
      'INSERT INTO rpc_errors (hour, name, count) VALUES (?, ?, 1) ON CONFLICT (hour, name) DO UPDATE SET count = count + 1',
    )
    .bind(errorHour(at), name)
    .run();
}
