// Keeps a recording from changing the real account: every write to Supabase
// REST (POST/PATCH/PUT/DELETE, except read-only RPCs) is answered locally with
// a fake 2xx that echoes the body, so the app behaves as if it saved.
import type { Page, Route } from 'playwright';

// RPCs that only read — allowed through. Everything else under /rpc/ is blocked.
const READ_RPCS = new Set([
  'leaderboard',
  'training_totals',
  'get_blunder_motif_counts',
  'landing_stats',
  'admin_kpis',
  'admin_user_list',
]);

export const blockedWrites: string[] = [];

export async function installReadOnlyGuard(page: Page, opts: { log?: boolean } = {}) {
  await page.route(/\.supabase\.co\/rest\/v1\//, async (route: Route) => {
    const req = route.request();
    const method = req.method();
    const url = new URL(req.url());
    const rpc = url.pathname.match(/\/rpc\/([^/?]+)/)?.[1];
    const isWrite = method !== 'GET' && method !== 'HEAD' && !(rpc && READ_RPCS.has(rpc));
    if (!isWrite) return route.continue();

    blockedWrites.push(`${method} ${url.pathname}`);
    if (opts.log) console.log(`  [guard] blocked ${method} ${url.pathname}`);
    let body: unknown = null;
    try {
      body = req.postDataJSON();
    } catch {
      body = null;
    }
    // RPC writes return scalars/void; table writes return the representation.
    const payload = rpc ? null : Array.isArray(body) ? body : body ? [body] : [];
    await route.fulfill({
      status: rpc ? 200 : method === 'POST' ? 201 : 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/*' },
      body: JSON.stringify(payload),
    });
  });
}
