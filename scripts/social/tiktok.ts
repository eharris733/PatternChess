// TikTok Content Posting API, Upload mode (scope video.upload): the video
// lands in the creator's TikTok inbox as a draft and they post it from the
// app. (Direct public posting needs TikTok's audit, which a single-account
// tool can't pass.) Tokens live in KV `tiktok`; refresh tokens ROTATE, so a
// refreshed pair is saved before it's used — the workflow's concurrency group
// keeps two runs from racing it.
import { readFileSync, statSync } from 'node:fs';
import { kvGetJson, kvPutJson, type Target } from './cloudflare.ts';
import { env, requireEnv } from './env.ts';

const API = 'https://open.tiktokapis.com/v2';
const TOKENS: Target = { remote: true };

export interface TikTokToken {
  access_token: string;
  refresh_token: string;
  /** ISO times. */
  expires_at: string;
  refresh_expires_at: string;
  open_id: string;
  scope: string;
}

export class TikTokError extends Error {}

export function tiktokConfigured(): boolean {
  return !!env('TIKTOK_CLIENT_KEY') && !!env('TIKTOK_CLIENT_SECRET');
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** POST /oauth/token/ (authorization_code or refresh_token) → a stored token. */
export async function tokenRequest(params: Record<string, string>): Promise<TikTokToken> {
  const res = await fetch(`${API}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: requireEnv('TIKTOK_CLIENT_KEY'),
      client_secret: requireEnv('TIKTOK_CLIENT_SECRET'),
      ...params,
    }),
  });
  const j = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !j.access_token || !j.refresh_token) {
    throw new TikTokError(`oauth: ${j.error_description ?? j.error ?? `HTTP ${res.status}`}`);
  }
  const now = Date.now();
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: new Date(now + (j.expires_in ?? 0) * 1000).toISOString(),
    refresh_expires_at: new Date(now + (j.refresh_expires_in ?? 0) * 1000).toISOString(),
    open_id: j.open_id ?? '',
    scope: j.scope ?? '',
  };
}

export function saveTikTokToken(t: TikTokToken): void {
  kvPutJson('tiktok', t, TOKENS);
}

/**
 * A usable access token. Refreshes every run when it's within an hour of
 * expiring (access tokens are short-lived), which also keeps the refresh
 * token's own clock reset.
 */
export async function tiktokAccessToken(): Promise<TikTokToken> {
  const t = kvGetJson<TikTokToken>('tiktok', TOKENS);
  if (!t) throw new TikTokError('no TikTok token in KV (run scripts/social/tiktok-auth.ts)');
  if (Date.parse(t.expires_at) - Date.now() > 60 * 60_000) return t;
  if (Date.parse(t.refresh_expires_at) < Date.now()) throw new TikTokError('refresh token expired: run tiktok-auth.ts again');
  const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  saveTikTokToken(fresh); // the old refresh token stops working now
  return fresh;
}

async function api<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as { data?: T; error?: { code?: string; message?: string } };
  if (!res.ok || (j.error && j.error.code !== 'ok')) {
    throw new TikTokError(`${path}: ${j.error?.code ?? res.status} ${j.error?.message ?? ''}`.trim());
  }
  return j.data as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Upload a local MP4 to the inbox. Single chunk: TikTok allows one chunk up
 * to 64 MB, and these videos are well under 5 MB.
 */
export async function sendToInbox(mp4Path: string): Promise<{ publishId: string; status: string }> {
  const { access_token } = await tiktokAccessToken();
  const size = statSync(mp4Path).size;
  const init = await api<{ publish_id: string; upload_url: string }>('post/publish/inbox/video/init/', access_token, {
    source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 },
  });
  const put = await fetch(init.upload_url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(size),
      'Content-Range': `bytes 0-${size - 1}/${size}`,
    },
    body: readFileSync(mp4Path),
  });
  if (put.status !== 201 && put.status !== 200) throw new TikTokError(`upload: HTTP ${put.status}`);

  const deadline = Date.now() + 3 * 60_000;
  for (;;) {
    const s = await api<{ status: string; fail_reason?: string }>('post/publish/status/fetch/', access_token, {
      publish_id: init.publish_id,
    });
    if (s.status === 'SEND_TO_USER_INBOX' || s.status === 'PUBLISH_COMPLETE') return { publishId: init.publish_id, status: s.status };
    if (s.status === 'FAILED') throw new TikTokError(`upload failed: ${s.fail_reason ?? 'unknown'}`);
    if (Date.now() > deadline) return { publishId: init.publish_id, status: s.status };
    await sleep(4000);
  }
}
