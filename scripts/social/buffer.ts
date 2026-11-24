// Buffer's GraphQL API (https://developers.buffer.com): one endpoint, a
// personal API key from https://publish.buffer.com/settings/api in
// BUFFER_API_KEY. Buffer fetches the video from its public URL (our R2 domain)
// and publishes it to Instagram (a Reel), TikTok (a public post — Buffer is an
// audited TikTok partner, which our own app can't be) and YouTube (a Short:
// vertical and under 3 minutes, so YouTube files it as one).
import { requireEnv } from './env.ts';

export const BUFFER_ENDPOINT = 'https://api.buffer.com';

export type BufferChannel = 'instagram' | 'tiktok' | 'youtube';

/** YouTube category "Gaming" (chess channels file there). */
export const YOUTUBE_CATEGORY_ID = '20';

export interface GraphqlError {
  message: string;
  extensions?: { code?: string };
}

export class BufferError extends Error {}

type Fetch = typeof fetch;

/** One GraphQL call; honours 429 Retry-After once. */
export async function bufferGraphql<T>(query: string, variables: Record<string, unknown> = {}, f: Fetch = fetch): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await f(BUFFER_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${requireEnv('BUFFER_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429 && attempt === 0) {
      const wait = Math.min(120, Number(res.headers.get('retry-after') ?? '30'));
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const body = (await res.json().catch(() => null)) as { data?: T; errors?: GraphqlError[] } | null;
    if (!res.ok || !body || body.errors?.length) {
      const msg = body?.errors?.map((e) => `${e.extensions?.code ?? 'ERROR'}: ${e.message}`).join('; ') ?? `HTTP ${res.status}`;
      throw new BufferError(`Buffer: ${msg}`);
    }
    return body.data as T;
  }
}

export interface VideoPostInput {
  channelId: string;
  channel: BufferChannel;
  text: string;
  videoUrl: string;
  /** ISO time; Buffer publishes then. */
  dueAt: string;
  /** Save as a Buffer draft instead of scheduling it (SOCIAL_MODE=draft). */
  draft: boolean;
  /** Instagram only: posted as the first comment. */
  firstComment?: string;
  /** TikTok (optional) and YouTube (required). */
  title?: string;
  /** The poster frame, in ms into the video. */
  thumbnailOffsetMs?: number;
}

/** The createPost input for one channel (pure; unit-tested). */
export function createPostInput(p: VideoPostInput): Record<string, unknown> {
  if (p.channel === 'youtube' && !p.title?.trim()) throw new BufferError('YouTube posts need a title');
  const metadata =
    p.channel === 'instagram'
      ? { instagram: { type: 'reel', shouldShareToFeed: true, ...(p.firstComment ? { firstComment: p.firstComment } : {}) } }
      : p.channel === 'youtube'
        ? {
            youtube: {
              title: p.title!.slice(0, 100),
              categoryId: YOUTUBE_CATEGORY_ID,
              privacy: 'public',
              madeForKids: false,
              notifySubscribers: true,
              // The narrator is a synthetic voice: disclose it.
              isAiGenerated: true,
            },
          }
        : p.title
          ? { tiktok: { title: p.title } }
          : undefined;
  // Buffer applies thumbnailOffset only to Instagram / TikTok (/ Pinterest).
  const videoMeta = p.channel === 'youtube' ? undefined : { thumbnailOffset: p.thumbnailOffsetMs ?? 500 };
  return {
    channelId: p.channelId,
    text: p.text,
    schedulingType: 'automatic',
    mode: 'customScheduled',
    dueAt: p.dueAt,
    ...(p.draft ? { saveToDraft: true } : {}),
    assets: [{ video: { url: p.videoUrl, ...(videoMeta ? { metadata: videoMeta } : {}) } }],
    ...(metadata ? { metadata } : {}),
  };
}

const CREATE_POST = `mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { id status dueAt } }
    ... on MutationError { message }
  }
}`;

export async function createVideoPost(p: VideoPostInput, f: Fetch = fetch): Promise<{ id: string; status: string }> {
  const data = await bufferGraphql<{ createPost: { __typename: string; post?: { id: string; status: string }; message?: string } }>(
    CREATE_POST,
    { input: createPostInput(p) },
    f,
  );
  const r = data.createPost;
  if (r.post) return { id: r.post.id, status: r.post.status };
  throw new BufferError(`Buffer ${r.__typename}: ${r.message ?? 'createPost failed'}`);
}

export interface PostState {
  id: string;
  status: 'draft' | 'error' | 'needs_approval' | 'scheduled' | 'sending' | 'sent' | string;
  externalLink: string | null;
  sentAt: string | null;
  error: string | null;
}

const POST = `query Post($id: PostId!) {
  post(input: { id: $id }) { id status externalLink sentAt error { message } }
}`;

export async function postState(id: string, f: Fetch = fetch): Promise<PostState> {
  const data = await bufferGraphql<{ post: { id: string; status: string; externalLink: string | null; sentAt: string | null; error: { message: string } | null } }>(
    POST,
    { id },
    f,
  );
  const p = data.post;
  return { id: p.id, status: p.status, externalLink: p.externalLink, sentAt: p.sentAt, error: p.error?.message ?? null };
}

export interface ChannelRow {
  organization: string;
  id: string;
  name: string;
  service: string;
  paused: boolean;
}

export async function listChannels(f: Fetch = fetch): Promise<ChannelRow[]> {
  const orgs = await bufferGraphql<{ account: { organizations: { id: string; name: string }[] } }>(
    'query { account { organizations { id name } } }',
    {},
    f,
  );
  const out: ChannelRow[] = [];
  for (const o of orgs.account.organizations) {
    const data = await bufferGraphql<{ channels: { id: string; name: string; service: string; isQueuePaused: boolean }[] }>(
      'query Channels($org: OrganizationId!) { channels(input: { organizationId: $org }) { id name service isQueuePaused } }',
      { org: o.id },
      f,
    );
    for (const c of data.channels) out.push({ organization: o.name, id: c.id, name: c.name, service: c.service, paused: c.isQueuePaused });
  }
  return out;
}
