import { getAuth } from '../../_shared/auth';
import type { AppEnv } from '../../_shared/db';
import { withApiHeaders } from '../../_shared/rpc/core';

/**
 * better-auth's HTTP handler for every /api/auth/* route (sign-in, OAuth
 * callbacks, get-session, sign-out, …), all methods. Never cached; carries the
 * cross-origin isolation headers Function responses don't get from _headers.
 */
export const onRequest: PagesFunction<AppEnv> = async ({ request, env }) => {
  try {
    return withApiHeaders(await getAuth(env).handler(request));
  } catch (e) {
    console.error('[auth] handler failed', e instanceof Error ? e.stack ?? e.message : e);
    return withApiHeaders(
      new Response(JSON.stringify({ error: { code: 'auth_unavailable', message: 'Sign-in is unavailable right now.' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }
};
