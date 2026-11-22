import type { Page, Route } from '@playwright/test';

// Shared stubs for the Cloudflare backend. The app talks to two endpoints:
//
//  - better-auth at /api/auth/* (the client reads GET /api/auth/get-session
//    and signs out with POST /api/auth/sign-out), and
//  - the RPC endpoint POST /api/rpc/<name> with the args object as JSON,
//    answering `{ data }` (or `{ error: { code, message } }` + a status).
//
// Both are intercepted with page.route, which runs in the browser before
// Vite's dev proxy, so no API server is needed. Everything else (chess.com /
// Lichess APIs, /api/book, Stockfish) is left alone.

export interface StubUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  emailVerified?: boolean;
  createdAt?: string;
}

export const E2E_USER: StubUser = {
  id: 'e2e-user',
  email: 'e2e@example.com',
  name: 'E2E User',
  image: null,
  emailVerified: true,
};

/** better-auth's get-session body for `user` (null = signed out). */
export function sessionBody(user: StubUser | null) {
  if (!user) return null;
  const now = new Date().toISOString();
  const createdAt = user.createdAt ?? now;
  return {
    session: {
      id: `session-${user.id}`,
      token: `token-${user.id}`,
      userId: user.id,
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      createdAt,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image ?? null,
      emailVerified: user.emailVerified ?? true,
      createdAt,
      updatedAt: now,
    },
  };
}

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

/**
 * Fake better-auth session. `null` = signed out. Sign-out flips the stub to
 * signed out, so later get-session calls agree with the server.
 */
export async function stubSession(page: Page, user: StubUser | null = E2E_USER): Promise<void> {
  let current = user;
  await page.route('**/api/auth/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/get-session')) return route.fulfill(json(sessionBody(current)));
    if (path.endsWith('/sign-out')) {
      current = null;
      return route.fulfill(json({ success: true }));
    }
    // Sign-in redirects etc. are not exercised by the specs.
    return route.fulfill(json({ message: 'Not stubbed' }, 404));
  });
}

// ---------------------------------------------------------------------------
// RPC stub

export interface RpcCall {
  name: string;
  args: Record<string, any>;
}

/** A handler's return value is sent as `{ data }`; return a `Response` to control status/body. */
export type RpcHandler = (args: Record<string, any>, call: RpcCall) => unknown | Promise<unknown>;
export type RpcHandlers = Record<string, RpcHandler>;

export interface StubRpcOptions {
  /**
   * Answers names without a handler. Defaults to `defaultRpcValue` (empty
   * lists, zero counts, a default profile row, null otherwise).
   */
  fallback?: (name: string, args: Record<string, any>) => unknown;
}

export interface RpcRecorder {
  /** Every RPC the page sent, in order. */
  readonly calls: RpcCall[];
  /** Calls to one RPC, in order. */
  callsTo(name: string): RpcCall[];
  /** Resolve with the first call to `name` matching `predicate` (polls; default 10s). */
  waitFor(name: string, predicate?: (args: Record<string, any>) => boolean, timeoutMs?: number): Promise<RpcCall>;
}

const recorders = new WeakMap<Page, RpcRecorder>();

/** Calls recorded by `stubRpc` for this page (optionally one RPC). */
export function getRpcCalls(page: Page, name?: string): RpcCall[] {
  const rec = recorders.get(page);
  if (!rec) return [];
  return name ? rec.callsTo(name) : rec.calls;
}

/** An RPC error reply (`{ error: { code, message } }` with `status`). */
export function rpcError(status: number, message = 'Stubbed failure', code = `http_${status}`): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export const DEFAULT_PROFILE_ROW: Record<string, unknown> = {
  id: E2E_USER.id,
  display_name: E2E_USER.name,
  avatar_url: null,
  lichess_username: null,
  chesscom_username: null,
  preferred_rated_only: false,
  preferred_time_controls: [],
  last_synced_lichess_at: null,
  last_synced_chesscom_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  current_streak_days: 0,
  longest_streak_days: 0,
  streak_freezes: 0,
  last_drill_local_date: null,
  timezone: null,
  board_theme: 'default',
  show_engine_evals: false,
  reveal_before_solve: false,
  email_opt_in: false,
  app_opens: 0,
};

const LIST_RPCS = new Set([
  'games.insert',
  'games.list',
  'games.scenarioGames',
  'games.unanalyzedIds',
  'games.leftoverUnanalyzedIds',
  'games.externalIds',
  'games.playedSince',
  'games.unparsed',
  'games.unclassifiedOpenings',
  'games.byIds',
  'blunders.forGames',
  'blunders.due',
  'blunders.liveIdsForGames',
  'blunders.drillsOfKind',
  'blunders.allLive',
  'blunders.byIds',
  'blunders.endgameCandidates',
  'blunders.forDeepening',
  'blunders.unenriched',
  'endgameScenarios.list',
  'endgameScenarios.unverified',
  'repertoire.list',
  'sessions.recent',
  'sessions.since',
  'benchmarks.list',
  'stats.blunderRows',
  'stats.gameRows',
  'openings.uncheckedGames',
  'openings.pendingEvals',
  'openings.pastBookQueue',
  'openings.list',
  'openings.bookDepthRows',
  'admin.userList',
  'admin.landingCtas',
  'admin.supporters',
]);

const NUMBER_RPCS = new Set([
  'games.delete',
  'games.deleteMany',
  'games.applyOpenings',
  'blunders.delete',
  'openings.retireOrphanDrills',
  'profile.bumpAppOpen',
  'profile.incrementShares',
  'profile.incrementOpeningReviews',
  'profile.markLearnChapterDone',
]);

const BOOLEAN_RPCS = new Set([
  'sessions.hasToday',
  'openings.hasTacticForGamePosition',
  'profile.claimSignupSource',
  'profile.claimReferral',
]);

/** The "empty account" answer for any RPC name. */
export function defaultRpcValue(name: string, _args: Record<string, any> = {}): unknown {
  if (name === 'profile.get' || name === 'profile.getOrCreate') return { ...DEFAULT_PROFILE_ROW };
  if (LIST_RPCS.has(name)) return [];
  if (NUMBER_RPCS.has(name)) return 0;
  if (BOOLEAN_RPCS.has(name)) return false;
  const fn = name.split('.')[1] ?? '';
  if (/^count|Count$/.test(fn)) return 0;
  switch (name) {
    case 'blunders.countsByGame':
      return {};
    case 'stats.motifCounts':
      return { counts: {}, tagged: 0, untagged: 0, total: 0 };
    case 'profile.trainingTotals':
      return { minutes: 0, activeDays: 0 };
    case 'leaderboard.get':
      return { since: null, rows: [], me: null };
    case 'leaderboard.public':
      return { since: null, computedAt: new Date().toISOString(), rows: [] };
    default:
      return null;
  }
}

/**
 * Intercept POST /api/rpc/<name>. `handlers` answer by name; anything else
 * goes to `fallback` (default: `defaultRpcValue`). Every call is recorded —
 * read them from the returned recorder or `getRpcCalls(page)`.
 *
 * Calling it again on the same page adds handlers on top (later routes win
 * in Playwright) and keeps one shared recorder.
 */
export async function stubRpc(page: Page, handlers: RpcHandlers = {}, opts: StubRpcOptions = {}): Promise<RpcRecorder> {
  let rec = recorders.get(page);
  if (!rec) {
    const calls: RpcCall[] = [];
    rec = {
      calls,
      callsTo: (name) => calls.filter((c) => c.name === name),
      async waitFor(name, predicate = () => true, timeoutMs = 10_000) {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
          const hit = calls.find((c) => c.name === name && predicate(c.args));
          if (hit) return hit;
          if (Date.now() > deadline) throw new Error(`Timed out waiting for RPC ${name}`);
          await new Promise((r) => setTimeout(r, 50));
        }
      },
    };
    recorders.set(page, rec);
  }
  const recorder = rec;
  const fallback = opts.fallback ?? defaultRpcValue;

  await page.route('**/api/rpc/*', async (route: Route) => {
    const req = route.request();
    const name = decodeURIComponent(new URL(req.url()).pathname.split('/').pop() ?? '');
    let args: Record<string, any> = {};
    try {
      args = (req.postDataJSON() as Record<string, any> | null) ?? {};
    } catch {
      args = {};
    }
    const call: RpcCall = { name, args };
    recorder.calls.push(call);
    let result: unknown;
    try {
      const handler = handlers[name];
      result = handler ? await handler(args, call) : fallback(name, args);
    } catch (e) {
      return route.fulfill(json({ error: { code: 'stub_error', message: String(e) } }, 500));
    }
    if (result instanceof Response) {
      return route.fulfill({
        status: result.status,
        contentType: result.headers.get('content-type') ?? 'application/json',
        body: await result.text(),
      });
    }
    return route.fulfill(json({ data: result ?? null }));
  });
  return recorder;
}

// ---------------------------------------------------------------------------
// Seeded data → handlers

type Row = Record<string, any>;

export interface SeedData {
  /** Merged over DEFAULT_PROFILE_ROW; served by profile.get / getOrCreate, patched by profile.update. */
  profile?: Row;
  games?: Row[];
  blunders?: Row[];
  endgameScenarios?: Row[];
  repertoire?: Row[];
  sessions?: Row[];
  deviations?: Row[];
  /**
   * games.totalCount / games.count. Defaults to games.length, or 3 when no
   * games are seeded — an "established" account, so the onboarding gate (a
   * zero count) stays out of the way. Pass 0 for a brand-new user.
   */
  gameCount?: number;
}

const nowIso = () => new Date().toISOString();
const live = (r: Row) => !r.retired_at;
const isDue = (r: Row) => live(r) && (!r.next_drill_at || String(r.next_drill_at) <= nowIso());
const kindOf = (r: Row) => (r.kind as string | undefined) ?? 'tactic';
const inIds = (ids: unknown, id: unknown) => Array.isArray(ids) && ids.includes(id);

/**
 * Handlers that answer the read RPCs from seeded rows with the server's
 * filters (functions/_shared/rpc/*.ts), plus a stateful profile. Spread
 * them into `stubRpc` handlers and override what a test needs.
 */
export function seededHandlers(seed: SeedData): RpcHandlers {
  const profile: Row = { ...DEFAULT_PROFILE_ROW, ...(seed.profile ?? {}) };
  const games = seed.games ?? [];
  const blunders = seed.blunders ?? [];
  const scenarios = seed.endgameScenarios ?? [];
  const gameCount = seed.gameCount ?? (games.length || 3);
  const h: RpcHandlers = {
    'profile.get': () => profile,
    'profile.getOrCreate': () => profile,
    'profile.update': (args) => {
      Object.assign(profile, args.patch ?? {});
      return null;
    },
    'games.totalCount': () => gameCount,
    'games.count': () => gameCount,
  };
  if (seed.games) {
    Object.assign(h, {
      'games.list': () => games,
      'games.get': (a: Row) => games.find((g) => g.id === a.id) ?? null,
      'games.byIds': (a: Row) => games.filter((g) => inIds(a.ids, g.id)),
      'games.scenarioGames': (a: Row) => games.filter((g) => inIds(a.ids, g.id)),
      'games.countUnanalyzed': () => games.filter((g) => !g.analyzed_at).length,
      'games.playedSince': (a: Row) =>
        games.filter((g) => g.played_at && String(g.played_at) >= String(a.since)).map((g) => g.played_at),
      'games.externalIds': (a: Row) =>
        games.filter((g) => g.platform === a.platform).map((g) => g.external_game_id ?? null),
      'stats.gameRows': (a: Row) => games.filter((g) => !a.afterId || String(g.id) > String(a.afterId)),
    } satisfies RpcHandlers);
  }
  if (seed.blunders) {
    const due = () => blunders.filter(isDue);
    Object.assign(h, {
      'blunders.due': due,
      'blunders.dueCount': (a: Row) => due().filter((b) => !a.excludeKind || kindOf(b) !== a.excludeKind).length,
      'blunders.firstDueTactic': () => due().find((b) => kindOf(b) === 'tactic') ?? null,
      'blunders.allLive': () => blunders.filter(live),
      'blunders.byIds': (a: Row) => blunders.filter((b) => live(b) && inIds(a.ids, b.id)),
      'blunders.forGames': (a: Row) => blunders.filter((b) => inIds(a.gameIds, b.game_id)),
      'blunders.liveIdsForGames': (a: Row) =>
        blunders
          .filter((b) => live(b) && kindOf(b) !== 'opening' && inIds(a.gameIds, b.game_id))
          .map((b) => b.id),
      'blunders.drillsOfKind': (a: Row) => blunders.filter((b) => live(b) && kindOf(b) === a.kind),
      'blunders.endgameCandidates': () =>
        blunders.filter((b) => live(b) && kindOf(b) === 'tactic' && b.phase === 'endgame'),
      'blunders.countsByGame': () => {
        const out: Record<string, number> = {};
        for (const b of blunders) {
          if (kindOf(b) === 'tactic' && b.game_id) out[b.game_id] = (out[b.game_id] ?? 0) + 1;
        }
        return out;
      },
      'blunders.dueBetweenCount': (a: Row) =>
        blunders.filter(
          (b) => b.next_drill_at && String(b.next_drill_at) >= a.from && String(b.next_drill_at) < a.to,
        ).length,
      'stats.blunderRows': (a: Row) => blunders.filter((b) => !a.afterId || String(b.id) > String(a.afterId)),
      // Server-side aggregation (stats.motifCounts): tactic rows with a
      // solution line are "tagged"; the rest are untagged.
      'stats.motifCounts': () => {
        const counts: Record<string, number> = {};
        let tagged = 0;
        let untagged = 0;
        const tactics = blunders.filter((b) => kindOf(b) === 'tactic' && live(b));
        for (const b of tactics) {
          if (b.solution_line == null) {
            untagged++;
            continue;
          }
          tagged++;
          for (const m of (b.motifs as string[] | undefined) ?? []) counts[m] = (counts[m] ?? 0) + 1;
        }
        return { counts, tagged, untagged, total: tactics.length };
      },
    } satisfies RpcHandlers);
  }
  if (seed.endgameScenarios) {
    Object.assign(h, {
      'endgameScenarios.list': () => scenarios.filter(live),
    } satisfies RpcHandlers);
  }
  if (seed.repertoire) {
    const rep = seed.repertoire;
    Object.assign(h, { 'repertoire.list': () => rep } satisfies RpcHandlers);
  }
  if (seed.sessions) {
    const sessions = seed.sessions;
    Object.assign(h, {
      'sessions.recent': () => sessions,
      'sessions.since': (a: Row) =>
        sessions.filter((s) => !s.local_date || String(s.local_date) >= String(a.sinceDate)),
    } satisfies RpcHandlers);
  }
  if (seed.deviations) {
    const deviations = seed.deviations;
    Object.assign(h, { 'openings.list': () => deviations } satisfies RpcHandlers);
  }
  return h;
}

export interface StubAppOptions extends SeedData {
  /** Signed-in user; null = signed out. Default E2E_USER. */
  user?: StubUser | null;
  /** Per-test handlers, applied over the seeded ones. */
  rpc?: RpcHandlers;
  fallback?: StubRpcOptions['fallback'];
}

/** `stubSession` + `stubRpc(seededHandlers(...))` in one call. */
export async function stubApp(page: Page, opts: StubAppOptions = {}): Promise<RpcRecorder> {
  const { user = E2E_USER, rpc, fallback, ...seed } = opts;
  await stubSession(page, user);
  return stubRpc(page, { ...seededHandlers(seed), ...(rpc ?? {}) }, { fallback });
}
