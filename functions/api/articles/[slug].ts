import { PERK_STATUSES, authedUser, json, supporterBy, type SupabaseEnv } from '../../_shared/supporters';

interface Env extends SupabaseEnv {
  /** KV `patternchess-content`: `article:<slug>` → rendered HTML (npm run articles:sync). */
  CONTENT: KVNamespace;
}

/**
 * GET → { html } of one /path article, for active supporters only. The bodies
 * live in KV (never in the public repo or the JS bundle); titles and teasers
 * are public in src/generated/articles.json.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const user = await authedUser(request, env);
  if (!user) return json({ error: 'sign_in_required' }, 401);

  const row = await supporterBy(env, 'user_id', user.id);
  if (!row || !PERK_STATUSES.has(row.status)) return json({ error: 'supporters_only' }, 403);

  const slug = String(params.slug ?? '');
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return json({ error: 'not_found' }, 404);
  const html = await env.CONTENT.get(`article:${slug}`);
  if (html == null) return json({ error: 'not_found' }, 404);
  return json({ html });
};
