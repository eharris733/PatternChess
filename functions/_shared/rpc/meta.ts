import { publicRpc, userRpc, type RpcRegistry } from './core';

/**
 * Example domain module. A domain exports `handlers: RpcRegistry`; ./index
 * merges every domain's handlers into one registry.
 */
export const handlers: RpcRegistry = {
  /** Liveness: does the Function run and can it reach D1? */
  health: publicRpc(async (ctx) => {
    let db = false;
    try {
      db = (await ctx.db.prepare('select 1 as ok').first<{ ok: number }>())?.ok === 1;
    } catch {
      db = false;
    }
    return { ok: true, db, signedIn: !!ctx.user };
  }),

  /** The signed-in user as the server sees it (email is null for Lichess accounts). */
  me: userRpc(async (ctx) => ctx.user),
};
