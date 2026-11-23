import { isUsStateCode } from '../../../src/lib/usStates';
import { eventCountryFromLocation } from '../../../src/lib/eventRegions';
import { userRpc, type RpcRegistry } from './core';

/**
 * OTB events helpers. The tournament listings come straight from
 * events.patternchess.com in the browser; nothing here proxies them. The saved
 * region is `profiles.events_country` (+ `events_state` in the US), written
 * through profile.update.
 */

export interface EventsLocation {
  /**
   * The caller's country from Cloudflare's IP geolocation, as an events
   * country code ('US', 'CA', 'GB-ENG' for England) or a plain ISO country
   * where events.patternchess.com has no listings ('BR'); null when unknown.
   */
  country: string | null;
  /** US state code ("MA") when the request comes from the US; else null. */
  region: string | null;
}

/**
 * The request's approximate location from Cloudflare (`request.cf`): the
 * country (UK home nations split), plus the state inside the US. Nothing is
 * stored; the player's pick is what gets saved.
 */
export function locationFromRequest(request: Request): EventsLocation {
  const cf = (request as Request & { cf?: { country?: unknown; regionCode?: unknown } }).cf;
  const iso = typeof cf?.country === 'string' && cf.country ? cf.country.toUpperCase() : null;
  const code = typeof cf?.regionCode === 'string' ? cf.regionCode.toUpperCase() : null;
  const country = eventCountryFromLocation(iso, code);
  return { country, region: country === 'US' && isUsStateCode(code) ? code : null };
}

export const handlers: RpcRegistry = {
  /**
   * Where the caller probably is, for the events card's first guess before
   * they pick a state. Read from the request only; nothing is stored.
   */
  'events.locate': userRpc(async (ctx) => locationFromRequest(ctx.request)),
};
