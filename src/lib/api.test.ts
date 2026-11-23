import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, rpc } from './api';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('rpc', () => {
  it('POSTs the args as JSON to /api/rpc/:name and returns data', async () => {
    const fn = mockFetch(200, { data: { ok: 1 } });
    await expect(rpc('games.list', { limit: 5 })).resolves.toEqual({ ok: 1 });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/rpc/games.list');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(init.body).toBe('{"limit":5}');
  });

  it('throws ApiError with the server code + status', async () => {
    mockFetch(401, { error: { code: 'unauthorized', message: 'Sign in required' } });
    const err = (await rpc('me').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, code: 'unauthorized', message: 'Sign in required' });
    expect(err.isUnauthorized).toBe(true);
  });

  it('throws on a non-JSON error page', async () => {
    mockFetch(502, '<html>Bad gateway</html>');
    await expect(rpc('me')).rejects.toMatchObject({ status: 502, code: 'http_502' });
  });

  it('maps a null data payload to null', async () => {
    mockFetch(200, { data: null });
    await expect(rpc('nothing')).resolves.toBeNull();
  });
});
