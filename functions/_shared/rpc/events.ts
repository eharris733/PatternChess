import { isUsStateCode } from '../../../src/lib/usStates';
import { userRpc, type RpcRegistry } from './core';

/**
 * OTB events helpers. The tournament listings come straight from
 * events.patternchess.com in the browser; nothing here proxies them. The saved
 * state is `profiles.events_state`, written through profile.update.
 */

export interface EventsLocation {
  /** ISO country from Cloudflare's IP geolocation, e.g. "US"; null when unknown. */
  country: string | null;
  /** US state code ("MA") when the request comes from the US; else null. */
  region: string | null;
}

/** The request's coarse location from Cloudflare (`request.cf`), US states only. */
export function locationFromRequest(request: Request): EventsLocation {
  const cf = (request as Request & { cf?: { country?: unknown; regionCode?: unknown } }).cf;
  const country = typeof cf?.country === 'string' && cf.country ? cf.country.toUpperCase() : null;
  const code = typeof cf?.regionCode === 'string' ? cf.regionCode.toUpperCase() : null;
  return { country, region: country === 'US' && isUsStateCode(code) ? code : null };
}

export const handlers: RpcRegistry = {
  /**
   * Where the caller probably is, for the events card's first guess before
   * they pick a state. Read from the request only; nothing is stored.
   */
  'events.locate': userRpc(async (ctx) => locationFromRequest(ctx.request)),
};
