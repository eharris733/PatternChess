import { getSessionUser, isAdminEmail } from '../auth';
import type { AppEnv } from '../db';
import { dispatchRpc, type RpcRegistry } from './core';
import { handlers as meta } from './meta';
import { handlers as leaderboard } from './leaderboard';
import { handlers as admin } from './admin';
import { handlers as openings } from './openings';
import { handlers as training } from './training';
import { handlers as profile } from './profile';
import { handlers as social } from './social';
import { handlers as vault } from './vault';
import { handlers as events } from './events';
import { handlers as courses } from './courses';

export * from './core';

/**
 * Every RPC, by name. Add a domain by importing its `handlers` and listing it
 * in DOMAINS; duplicate names throw at startup so two domains can't shadow
 * each other silently.
 */
const DOMAINS: Record<string, RpcRegistry> = {
  meta,
  leaderboard,
  admin,
  openings,
  training,
  profile,
  social,
  vault,
  events,
  courses,
};

export function mergeRegistries(domains: Record<string, RpcRegistry>): RpcRegistry {
  const out: RpcRegistry = {};
  for (const [domain, handlers] of Object.entries(domains)) {
    for (const [name, def] of Object.entries(handlers)) {
      if (Object.prototype.hasOwnProperty.call(out, name)) {
        throw new Error(`RPC "${name}" is defined twice (second time in domain "${domain}")`);
      }
      out[name] = def;
    }
  }
  return out;
}

export const registry: RpcRegistry = mergeRegistries(DOMAINS);

/** POST /api/rpc/:name with the real registry + session lookup. */
export function handleRpc(
  name: string,
  request: Request,
  env: AppEnv,
  waitUntil: (p: Promise<unknown>) => void,
): Promise<Response> {
  return dispatchRpc(name, request, env, waitUntil, {
    registry,
    getUser: getSessionUser,
    isAdmin: (user) => isAdminEmail(user.email),
  });
}
