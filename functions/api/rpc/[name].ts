import type { AppEnv } from '../../_shared/db';
import { handleRpc } from '../../_shared/rpc/index';

/**
 * POST /api/rpc/:name — body = JSON args object →
 * 200 { data } | 4xx/5xx { error: { code, message } }. See functions/_shared/rpc.
 */
export const onRequest: PagesFunction<AppEnv, 'name'> = (context) => {
  const raw = context.params.name;
  const name = Array.isArray(raw) ? raw.join('/') : raw;
  return handleRpc(name, context.request, context.env, (p) => context.waitUntil(p));
};
