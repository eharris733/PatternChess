// Instagram API: publish a Reel, read its insights, keep the token fresh.
// Two token kinds, both stored in KV `ig` by set-token.ts:
// - Instagram Login (graph.instagram.com): a 60-day token, refreshed by publish.ts.
// - Unified login (graph.facebook.com): a system-user token from a business
//   portfolio that never expires (Meta's only option for apps created since
//   late 2026). `user_id` is then the Instagram professional account id.
// Same endpoints on both hosts: {ig-user}/media, media_publish, insights.
import { kvGetJson, kvPutJson, type Target } from './cloudflare.ts';
import { env } from './env.ts';

export type IgHost = 'graph.instagram.com' | 'graph.facebook.com';
const version = () => env('IG_API_VERSION') ?? 'v24.0';
const TOKENS: Target = { remote: true };

export interface IgToken {
  access_token: string;
  refreshed_at: string;
  user_id: string;
  username?: string;
  /** Missing on tokens saved before Unified login support = graph.instagram.com. */
  host?: IgHost;
}

const hostOf = (t: Pick<IgToken, 'host'>): IgHost => t.host ?? 'graph.instagram.com';

export class IgError extends Error {}

async function call<T>(method: 'GET' | 'POST', path: string, params: Record<string, string>, token: string, host: IgHost = 'graph.instagram.com'): Promise<T> {
  const url = new URL(`https://${host}/${version()}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: token });
  const res =
    method === 'GET'
      ? await fetch(`${url}?${body}`)
      : await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!res.ok || json.error) throw new IgError(`${path}: ${json.error?.message ?? `HTTP ${res.status}`}`);
  return json;
}

export function loadIgToken(): IgToken {
  const t = kvGetJson<IgToken>('ig', TOKENS);
  if (!t?.access_token) throw new IgError('no Instagram token in KV (run scripts/social/set-token.ts)');
  return t;
}

export function saveIgToken(t: IgToken): void {
  kvPutJson('ig', t, TOKENS);
}

export async function whoAmI(token: string): Promise<{ user_id: string; username: string }> {
  return call('GET', 'me', { fields: 'user_id,username' }, token);
}

/** Unified login: the account's username, which also proves the token can read it. */
export async function igAccount(token: string, igUserId: string): Promise<{ id: string; username: string }> {
  return call('GET', igUserId, { fields: 'id,username' }, token, 'graph.facebook.com');
}

/** Refresh when the token is older than `maxAgeDays` (it must be ≥ 24h old to refresh). */
export async function refreshIgTokenIfStale(maxAgeDays = 7): Promise<boolean> {
  const t = loadIgToken();
  if (hostOf(t) === 'graph.facebook.com') return false; // system-user tokens never expire
  if (Date.now() - Date.parse(t.refreshed_at) < maxAgeDays * 86400_000) return false;
  const res = await fetch(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: t.access_token })}`);
  const json = (await res.json()) as { access_token?: string; error?: { message?: string } };
  if (!res.ok || !json.access_token) throw new IgError(`refresh: ${json.error?.message ?? `HTTP ${res.status}`}`);
  saveIgToken({ ...t, access_token: json.access_token, refreshed_at: new Date().toISOString() });
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Container → wait until Instagram has fetched and processed the video → publish. */
export async function publishReel(opts: { videoUrl: string; caption: string; thumbOffsetMs?: number }): Promise<{ id: string; permalink: string | null }> {
  const t = loadIgToken();
  const container = await call<{ id: string }>(
    'POST',
    `${t.user_id}/media`,
    {
      media_type: 'REELS',
      video_url: opts.videoUrl,
      caption: opts.caption,
      share_to_feed: 'true',
      thumb_offset: String(opts.thumbOffsetMs ?? 500),
    },
    t.access_token,
    hostOf(t),
  );
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    const s = await call<{ status_code?: string; status?: string }>('GET', container.id, { fields: 'status_code,status' }, t.access_token, hostOf(t));
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new IgError(`container ${s.status_code}: ${s.status ?? ''}`);
    if (Date.now() > deadline) throw new IgError('container still processing after 10 minutes');
    await sleep(5000);
  }
  const media = await call<{ id: string }>('POST', `${t.user_id}/media_publish`, { creation_id: container.id }, t.access_token, hostOf(t));
  const info = await call<{ permalink?: string }>('GET', media.id, { fields: 'permalink' }, t.access_token, hostOf(t)).catch(() => ({ permalink: undefined }));
  return { id: media.id, permalink: info.permalink ?? null };
}

export interface ReelInsights {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saved: number | null;
  shares: number | null;
}

export async function reelInsights(mediaId: string): Promise<ReelInsights> {
  const t = loadIgToken();
  const res = await call<{ data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(
    'GET',
    `${mediaId}/insights`,
    { metric: 'views,reach,likes,comments,saved,shares' },
    t.access_token,
    hostOf(t),
  );
  const get = (name: string) => {
    const m = res.data.find((d) => d.name === name);
    return m?.total_value?.value ?? m?.values?.[0]?.value ?? null;
  };
  return { views: get('views'), reach: get('reach'), likes: get('likes'), comments: get('comments'), saved: get('saved'), shares: get('shares') };
}
