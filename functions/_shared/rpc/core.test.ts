import { describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '../auth';
import type { AppEnv } from '../db';
import { adminRpc, badRequest, dispatchRpc, publicRpc, userRpc, type RpcRegistry } from './core';
import { mergeRegistries } from './index';

const alice: SessionUser = { id: 'u-alice', email: 'alice@example.com', name: 'Alice', image: null, provider: 'google' };
const admin: SessionUser = { ...alice, id: 'u-admin', email: 'boss@example.com' };
const env = { DB: {} as D1Database } as AppEnv;

const registry: RpcRegistry = {
  echo: userRpc<{ x: number }>(async (ctx, args) => ({ uid: ctx.user.id, x: args.x })),
  nothing: userRpc(async () => undefined),
  stats: adminRpc(async (ctx) => ({ admin: ctx.user.email })),
  ping: publicRpc(async (ctx) => ({ signedIn: !!ctx.user })),
  bad: userRpc(async () => {
    throw badRequest('nope', 'bad_thing');
  }),
  boom: userRpc(async () => {
    throw new Error('secret internals');
  }),
};

function req(body?: unknown, opts: { cookie?: string; method?: string; contentType?: string; origin?: string } = {}) {
  const headers = new Headers({ host: 'patternchess.com' });
  if (body !== undefined) headers.set('content-type', opts.contentType ?? 'application/json');
  if (opts.cookie) headers.set('cookie', opts.cookie);
  if (opts.origin) headers.set('origin', opts.origin);
  return new Request('https://patternchess.com/api/rpc/x', {
    method: opts.method ?? 'POST',
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function deps(user: SessionUser | null) {
  const getUser = vi.fn(async () => user);
  return { registry, getUser, isAdmin: (u: SessionUser) => u.email === 'boss@example.com' };
}

async function call(name: string, user: SessionUser | null, r = req({})) {
  const d = deps(user);
  const res = await dispatchRpc(name, r, env, () => {}, d);
  return { res, body: (await res.json()) as { data?: unknown; error?: { code: string; message: string } }, d };
}

describe('dispatchRpc', () => {
  it('runs a user handler with ctx.user and the JSON args', async () => {
    const { res, body } = await call('echo', alice, req({ x: 7 }));
    expect(res.status).toBe(200);
    expect(body).toEqual({ data: { uid: 'u-alice', x: 7 } });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
  });

  it('maps undefined results to data: null and accepts an empty body', async () => {
    const { body } = await call('nothing', alice, req());
    expect(body).toEqual({ data: null });
  });

  it('401s a user handler without a session', async () => {
    const { res, body } = await call('echo', null, req({ x: 1 }));
    expect(res.status).toBe(401);
    expect(body.error?.code).toBe('unauthorized');
  });

  it('403s an admin handler for a non-admin and runs it for an admin', async () => {
    expect((await call('stats', alice)).res.status).toBe(403);
    const ok = await call('stats', admin);
    expect(ok.res.status).toBe(200);
    expect(ok.body.data).toEqual({ admin: 'boss@example.com' });
    expect((await call('stats', null)).res.status).toBe(401);
  });

  it('runs public handlers signed out without a session lookup', async () => {
    const { res, body, d } = await call('ping', alice);
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ signedIn: false });
    expect(d.getUser).not.toHaveBeenCalled();
  });

  it('fills ctx.user on public handlers when a session cookie is present', async () => {
    const { body, d } = await call('ping', alice, req({}, { cookie: '__Secure-better-auth.session_token=abc' }));
    expect(body.data).toEqual({ signedIn: true });
    expect(d.getUser).toHaveBeenCalledOnce();
  });

  it('404s unknown names, including prototype keys', async () => {
    expect((await call('nope', alice)).res.status).toBe(404);
    expect((await call('constructor', alice)).res.status).toBe(404);
    expect((await call('__proto__', alice)).res.status).toBe(404);
  });

  it('400s bad JSON and non-object args', async () => {
    expect((await call('echo', alice, req('{oops'))).body.error?.code).toBe('bad_json');
    expect((await call('echo', alice, req([1, 2]))).res.status).toBe(400);
    expect((await call('echo', alice, req('"str"'))).res.status).toBe(400);
  });

  it('refuses non-JSON bodies, non-POST and cross-site origins', async () => {
    expect((await call('echo', alice, req('{"x":1}', { contentType: 'text/plain' }))).res.status).toBe(415);
    expect((await call('echo', alice, req(undefined, { method: 'GET' }))).res.status).toBe(405);
    expect((await call('echo', alice, req({}, { origin: 'https://evil.example' }))).res.status).toBe(403);
    expect((await call('echo', alice, req({ x: 1 }, { origin: 'https://patternchess.com' }))).res.status).toBe(200);
  });

  it('turns RpcError into its status and hides other errors as 500', async () => {
    const bad = await call('bad', alice);
    expect(bad.res.status).toBe(400);
    expect(bad.body.error).toEqual({ code: 'bad_thing', message: 'nope' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = await call('boom', alice);
    spy.mockRestore();
    expect(boom.res.status).toBe(500);
    expect(boom.body.error?.message).not.toContain('secret');
  });
});

describe('mergeRegistries', () => {
  it('merges domains and rejects duplicate names', () => {
    const a = { one: publicRpc(async () => 1) };
    const b = { two: publicRpc(async () => 2) };
    expect(Object.keys(mergeRegistries({ a, b }))).toEqual(['one', 'two']);
    expect(() => mergeRegistries({ a, b: { one: publicRpc(async () => 3) } })).toThrow(/defined twice/);
  });
});
