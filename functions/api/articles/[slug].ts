import { getSessionUser } from '../../_shared/auth';
import type { AppEnv } from '../../_shared/db';
import { json } from '../../_shared/supporters';
import { hasSupporterPerks } from '../../_shared/supporterGrants';

interface Env extends AppEnv {
  /** KV `patternchess-content`: `article:<slug>` → rendered HTML (npm run articles:sync). */
  CONTENT: KVNamespace;
}

/**
 * GET → { html } of one /path article, for players with Supporter perks only. The bodies
 * live in KV (never in the public repo or the JS bundle); titles and teasers
 * are public in src/generated/articles.json.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'sign_in_required' }, 401);

  // Perks = an active subscription or a supporter grant (the referral reward).
  if (!(await hasSupporterPerks(env.DB, user.id))) return json({ error: 'supporters_only' }, 403);

  const slug = String(params.slug ?? '');
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return json({ error: 'not_found' }, 404);
  const html = await env.CONTENT.get(`article:${slug}`);
  if (html == null) return json({ error: 'not_found' }, 404);
  return json({ html });
};
