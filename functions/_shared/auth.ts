import { betterAuth } from 'better-auth';
import { genericOAuth } from 'better-auth/plugins';
import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import { ADMIN_EMAILS } from '../../src/auth/admin';
import { type AppEnv, insertStmt, nowIso, uuid } from './db';

/**
 * better-auth on Pages Functions (mounted at /api/auth/* by
 * functions/api/auth/[[path]].ts), modelled on FindLocal's setup:
 * D1 through Kysely's D1Dialect, AUTH_KV as secondaryStorage (sessions live in
 * KV, not D1), no cookieCache (better-auth #4203), schema validation off (D1
 * blocks the PRAGMA introspection; d1/migrations owns the auth tables).
 *
 * Providers: Google (only when GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are set),
 * Lichess through genericOAuth (public PKCE client, no secret), and
 * email+password only when AUTH_TEST_MODE=1 (automated tests on preview/local).
 *
 * Users keep their Supabase uuids; new users get a uuid too. Lichess users have
 * no email, so they get the placeholder `<lichessId>@lichess.invalid`
 * (unique + NOT NULL in better-auth) and the app treats it as "no email".
 */

export const LICHESS_PLACEHOLDER_DOMAIN = '@lichess.invalid';
export const SESSION_EXPIRES_IN_S = 60 * 60 * 24 * 30; // 30 days
export const SESSION_UPDATE_AGE_S = 60 * 60 * 24; // refresh the expiry at most daily

/** Production + Pages preview hosts. Branch previews are `<branch>.patternchess-1et.pages.dev`. */
const PROD_HOSTS = ['patternchess.com', 'www.patternchess.com', 'patternchess-1et.pages.dev', '*.patternchess-1et.pages.dev'];
/**
 * Local dev hosts (trusted only when BETTER_AUTH_URL is localhost): the API on
 * 8788 and Vite on 5173 by default, plus the ports parallel checkouts use
 * (`PC_API_PORT` 8789–8799, `PORT` 5174–5199).
 */
const LOCAL_PORTS = [
  ...Array.from({ length: 12 }, (_, i) => 8788 + i),
  ...Array.from({ length: 27 }, (_, i) => 5173 + i),
];
const LOCAL_HOSTS = ['localhost', '127.0.0.1'].flatMap((h) => LOCAL_PORTS.map((p) => `${h}:${p}`));

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(LICHESS_PLACEHOLDER_DOMAIN);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email || isPlaceholderEmail(email)) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

/** Local dev (wrangler pages dev / Vite proxy): plain http, localhost trusted. */
export function isLocalEnv(env: Pick<AppEnv, 'BETTER_AUTH_URL'>): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(env.BETTER_AUTH_URL ?? '');
}

// ---------------------------------------------------------------------------
// Lichess
// ---------------------------------------------------------------------------

/** The subset of https://lichess.org/api/account we use. */
export interface LichessAccount {
  id: string;
  username: string;
}

/**
 * What better-auth's genericOAuth expects from getUserInfo. `id` becomes
 * `account.accountId` (the lowercase Lichess id — the same value Supabase stored
 * as the identity's provider_id, so imported users land on their account).
 */
export function mapLichessAccount(acc: LichessAccount) {
  const id = String(acc.id).toLowerCase();
  return {
    id,
    name: acc.username || id,
    email: `${id}${LICHESS_PLACEHOLDER_DOMAIN}`,
    emailVerified: false,
    image: undefined,
    username: acc.username || id,
  };
}

/** GET /api/account with the access token → the mapped user info (null on failure). */
export async function fetchLichessUserInfo(
  accessToken: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ReturnType<typeof mapLichessAccount> | null> {
  if (!accessToken) return null;
  const res = await fetchImpl('https://lichess.org/api/account', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      // Lichess serves 404 to crawler-looking / empty user agents.
      'User-Agent': 'PatternChess/1.0 (+https://patternchess.com)',
    },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as Partial<LichessAccount>;
  if (!body?.id) return null;
  return mapLichessAccount({ id: body.id, username: body.username ?? body.id });
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

const REFERRAL_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'; // no 0/O/1/I/L

/** 8-char public invite code (same alphabet as Postgres gen_referral_code()). */
export function genReferralCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => REFERRAL_ALPHABET[b % REFERRAL_ALPHABET.length]).join('');
}

export interface NewAuthUser {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
}

/**
 * The full default `profiles` row for a brand-new user — the Postgres column
 * defaults plus what authService.getOrCreateProfile filled in client-side.
 * `anon_id` (landing-page visitor id) lives in the browser's localStorage, so
 * the client stamps it afterwards when it is still null.
 */
export function defaultProfileRow(user: NewAuthUser): Record<string, unknown> {
  const lichess = isPlaceholderEmail(user.email);
  const realEmail = lichess ? null : user.email;
  const name = user.name?.trim() || null;
  return {
    id: user.id,
    display_name: name ?? realEmail?.split('@')[0] ?? null,
    avatar_url: lichess ? null : (user.image ?? null),
    lichess_username: lichess ? (name ?? user.email.slice(0, -LICHESS_PLACEHOLDER_DOMAIN.length)) : null,
    chesscom_username: null,
    created_at: nowIso(),
    last_synced_lichess_at: null,
    last_synced_chesscom_at: null,
    // Casual games are noise for training (2026-11-22 feedback): new accounts
    // train on rated games only. Existing accounts keep their choice.
    preferred_rated_only: true,
    preferred_time_controls: ['bullet', 'blitz', 'rapid', 'classical'],
    current_streak_days: 0,
    longest_streak_days: 0,
    last_drill_local_date: null,
    timezone: null,
    anon_id: null,
    board_theme: 'default',
    show_engine_evals: false,
    reveal_before_solve: false,
    autoplay_refutation: true,
    used_training_filter: false,
    sounds_enabled: true,
    leaderboard_opt_out: false,
    followed_instagram: false,
    shares_count: 0,
    show_answer_on_miss: false,
    opening_reviews_opened: 0,
    learn_chapters_done: [],
    flair: null,
    referral_code: genReferralCode(),
    referred_by: null,
    referrals_count: 0,
    signup_source: null,
    // Reminders are opt-out for accounts with a real address; a Lichess
    // sign-in has none, so nothing could be sent anyway.
    email_opt_in: !!realEmail,
    contact_email: null,
    contact_email_verified_at: null,
    email_reminders: 'daily',
    email_reports: 'weekly',
    email_hour: 18,
    email_unsub_token: uuid(),
    email_prompted_at: null,
    commitment_level: 'regular',
    daily_positions_goal: 10,
    daily_games_goal: 1,
    streak_freezes: 0,
    streak_freezes_used: 0,
    app_opens: 0,
    email_prompt_count: 0,
    course_prompted_at: null,
    course_prompt_count: 0,
    supporter_prompted_at: null,
    supporter_prompt_count: 0,
    email_unsubscribed_at: null,
  };
}

/**
 * Insert the default profile unless one exists. Retries on the (unlikely)
 * referral-code collision. Returns true when a row was inserted.
 */
export async function createProfileForUser(db: D1Database, user: NewAuthUser): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await insertStmt(db, 'profiles', defaultProfileRow(user), {
        onConflict: { target: ['id'] },
      }).run();
      return (res.meta?.changes ?? 0) > 0;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/UNIQUE/i.test(msg) || !/referral_code/i.test(msg)) throw e;
    }
  }
  throw new Error('could not allocate a unique referral code');
}

// ---------------------------------------------------------------------------
// better-auth instance
// ---------------------------------------------------------------------------

function kvSecondaryStorage(kv: KVNamespace) {
  return {
    get: (key: string) => kv.get(key),
    set: async (key: string, value: string, ttl?: number) => {
      // KV's minimum TTL is 60 s.
      await kv.put(key, value, ttl ? { expirationTtl: Math.max(60, Math.ceil(ttl)) } : {});
    },
    delete: async (key: string) => {
      await kv.delete(key);
    },
    getAndDelete: async (key: string) => {
      const value = await kv.get(key);
      if (value !== null) await kv.delete(key);
      return value;
    },
    // KV has no atomic increment: best-effort read-modify-write is enough for
    // rate limiting. TTL applies on the first write so the window is fixed.
    increment: async (key: string, ttl: number) => {
      const current = Number((await kv.get(key)) ?? '0');
      const next = current + 1;
      await kv.put(key, String(next), current === 0 && ttl ? { expirationTtl: Math.max(60, Math.ceil(ttl)) } : {});
      return next;
    },
  };
}

function buildAuth(env: AppEnv) {
  if (!env.DB) throw new Error('DB binding is not configured');
  if (!env.BETTER_AUTH_SECRET) throw new Error('BETTER_AUTH_SECRET is not set');
  const local = isLocalEnv(env);
  const db = new Kysely({ dialect: new D1Dialect({ database: env.DB }) });

  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  }

  const hosts = local ? [...PROD_HOSTS, ...LOCAL_HOSTS] : PROD_HOSTS;
  const fallback = env.BETTER_AUTH_URL || 'https://patternchess.com';

  return betterAuth({
    appName: 'PatternChess',
    database: { db, type: 'sqlite' },
    secret: env.BETTER_AUTH_SECRET,
    // Resolved per request from the Host header so production, every Pages
    // preview branch and localhost all work with one instance; unknown hosts
    // fall back to BETTER_AUTH_URL.
    baseURL: { allowedHosts: hosts, fallback, protocol: local ? 'http' : 'https' },
    trustedOrigins: hosts.map((h) => `${local && LOCAL_HOSTS.includes(h) ? 'http' : 'https'}://${h}`),
    secondaryStorage: env.AUTH_KV ? kvSecondaryStorage(env.AUTH_KV) : undefined,
    session: { expiresIn: SESSION_EXPIRES_IN_S, updateAge: SESSION_UPDATE_AGE_S },
    advanced: {
      database: { validateSchema: false, generateId: () => crypto.randomUUID() },
      // cf-connecting-ip is set by the edge and not spoofable (x-forwarded-for is).
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    emailAndPassword:
      env.AUTH_TEST_MODE === '1'
        ? { enabled: true, requireEmailVerification: false, autoSignIn: true }
        : { enabled: false },
    socialProviders,
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: 'lichess',
            name: 'Lichess',
            clientId: 'patternchess',
            authorizationUrl: 'https://lichess.org/oauth',
            tokenUrl: 'https://lichess.org/api/token',
            scopes: [],
            pkce: true,
            getUserInfo: (tokens) => fetchLichessUserInfo(tokens.accessToken),
          },
        ],
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          // The app profile row for brand-new users (imported users already have
          // one). Never fail the sign-in over it: the client's getOrCreateProfile
          // path creates it if this didn't.
          after: async (user) => {
            try {
              await createProfileForUser(env.DB, {
                id: user.id,
                email: user.email,
                name: user.name,
                image: user.image,
              });
            } catch (e) {
              console.error('[auth] profile create failed', user.id, e instanceof Error ? e.message : e);
            }
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof buildAuth>;

const cache = new WeakMap<object, Auth>();

/** The better-auth instance for this env (memoized: building it is not free). */
export function getAuth(env: AppEnv): Auth {
  const hit = cache.get(env);
  if (hit) return hit;
  const auth = buildAuth(env);
  cache.set(env, auth);
  return auth;
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

export type AuthProviderId = 'google' | 'lichess' | 'email';

/** The signed-in user as handlers see it. `email` is null for Lichess accounts. */
export interface SessionUser {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  /**
   * Derived without a DB read: placeholder email → lichess, verified email →
   * google (Google accounts are created verified; test-mode email accounts are not).
   */
  provider: AuthProviderId;
}

export function toSessionUser(u: {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  emailVerified?: boolean | null;
}): SessionUser {
  const placeholder = isPlaceholderEmail(u.email);
  return {
    id: String(u.id),
    email: placeholder ? null : (u.email ?? null),
    name: u.name ?? null,
    image: u.image ?? null,
    provider: placeholder ? 'lichess' : u.emailVerified ? 'google' : 'email',
  };
}

/** The authenticated user behind the request's session cookie, or null. */
export async function getSessionUser(request: Request, env: AppEnv): Promise<SessionUser | null> {
  try {
    const res = await getAuth(env).api.getSession({ headers: request.headers });
    return res?.user ? toSessionUser(res.user) : null;
  } catch (e) {
    console.error('[auth] getSession failed', e instanceof Error ? e.message : e);
    return null;
  }
}
