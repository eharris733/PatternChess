// Keeps a recording from changing the account: every RPC that writes
// (POST /api/rpc/<domain>.<verb…>, see functions/_shared/rpc/*) is answered
// locally with an empty result, so the app behaves as if it saved. Reads go
// through to the local backend. The recorder runs against the local D1 copy
// (scripts/dev-api.sh), so a write that slips past this list only touches
// that copy — never production — but it would make re-recordings drift.
import type { Page, Route } from 'playwright';

/** RPC verbs that change data (the part after the domain: `blunders.updateAfterDrill`). */
const WRITE_VERB = /^(insert|update|delete|save|upsert|create|mark|unmark|apply|bump|increment|claim|reset|set|retire|track)/;

export function isWriteRpc(name: string): boolean {
  const verb = name.split('.')[1] ?? '';
  return WRITE_VERB.test(verb);
}

export const blockedWrites: string[] = [];

export async function installReadOnlyGuard(page: Page, opts: { log?: boolean } = {}) {
  await page.route(/\/api\/rpc\/[^/?]+$/, async (route: Route) => {
    const url = new URL(route.request().url());
    const name = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    if (!isWriteRpc(name)) return route.continue();
    blockedWrites.push(name);
    if (opts.log) console.log(`  [guard] blocked ${name}`);
    // Bulk inserts return the inserted rows (the client spreads them); the rest return nothing.
    const data = /^insert/.test(name.split('.')[1] ?? '') ? [] : null;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
  });
}
