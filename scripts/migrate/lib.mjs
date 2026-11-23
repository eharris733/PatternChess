// Shared helpers for the Supabase -> D1 data move (export-supabase.mjs,
// import-d1.mjs, verify.mjs). See d1/README.md.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = join(REPO, 'data', 'migrate');
export const D1_NAME = 'patternchess-app';
export const D1_CONFIG = join(REPO, 'd1', 'wrangler.jsonc');
export const LOCAL_PERSIST = join(REPO, '.wrangler', 'state');

/**
 * The 17 public tables with their primary key. `pk` drives keyset paging in
 * the export (a stable order even while the app keeps writing); composite
 * keys page by offset.
 */
export const APP_TABLES = [
  { name: 'profiles', pk: ['id'] },
  { name: 'games', pk: ['id'] },
  { name: 'blunders', pk: ['id'] },
  { name: 'endgame_scenarios', pk: ['id'] },
  { name: 'opening_deviations', pk: ['id'] },
  { name: 'repertoire_moves', pk: ['id'] },
  { name: 'training_sessions', pk: ['id'] },
  { name: 'game_annotations', pk: ['id'] },
  { name: 'supporters', pk: ['user_id'] },
  { name: 'funnel_events', pk: ['id'] },
  { name: 'email_sends', pk: ['id'] },
  { name: 'email_confirmations', pk: ['token'] },
  { name: 'event_digest_subscribers', pk: ['id'] },
  { name: 'lead_outreach', pk: ['lead_key'] },
  { name: 'landing_stats_cache', pk: ['id'] },
  { name: 'public_leaderboard_cache', pk: ['id'] },
  { name: 'benchmarks', pk: ['kind', 'bucket'] },
];

/**
 * Export order: children before parents, auth users last. A child row's parent
 * then already existed when the child was read, so the later parent export
 * contains it even while the app keeps writing (import-d1.mjs still drops or
 * nulls any dangling reference and reports it).
 */
export const EXPORT_ORDER = [
  'game_annotations',
  'opening_deviations',
  'endgame_scenarios',
  'blunders',
  'games',
  'repertoire_moves',
  'training_sessions',
  'supporters',
  'email_sends',
  'email_confirmations',
  'profiles',
  'funnel_events',
  'event_digest_subscribers',
  'lead_outreach',
  'landing_stats_cache',
  'public_leaderboard_cache',
  'benchmarks',
];

/** FK-safe insert order (parents first). */
export const IMPORT_ORDER = [
  'profiles',
  'games',
  'blunders',
  'endgame_scenarios',
  'opening_deviations',
  'repertoire_moves',
  'training_sessions',
  'game_annotations',
  'supporters',
  'funnel_events',
  'email_sends',
  'email_confirmations',
  'event_digest_subscribers',
  'lead_outreach',
  'landing_stats_cache',
  'public_leaderboard_cache',
  'benchmarks',
];

/** Delete order for --fresh (children first, better-auth tables last). */
export const DELETE_ORDER = [
  'game_annotations',
  'opening_deviations',
  'endgame_scenarios',
  'blunders',
  'games',
  'repertoire_moves',
  'training_sessions',
  'supporters',
  'email_sends',
  'email_confirmations',
  'profiles',
  'funnel_events',
  'event_digest_subscribers',
  'lead_outreach',
  'landing_stats_cache',
  'public_leaderboard_cache',
  'benchmarks',
  'session',
  'account',
  'verification',
  'user',
];

/** KEY=value pairs from .env.local (values never printed). */
export function loadEnvLocal() {
  const file = join(REPO, '.env.local');
  const env = {};
  if (!existsSync(file)) return env;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}

export function supabaseCreds() {
  const env = { ...loadEnvLocal(), ...process.env };
  const url = (env.VITE_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Need VITE_SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY) in .env.local');
  }
  return { url, key };
}

/** fetch with retries; throws with status + a short body (never the key). */
export async function fetchRetry(url, init, label, attempts = 5) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      const body = (await res.text()).slice(0, 300);
      lastErr = new Error(`${label}: HTTP ${res.status} ${body}`);
      if (res.status < 500 && res.status !== 429) throw lastErr;
    } catch (e) {
      lastErr = e;
      if (/HTTP 4\d\d/.test(String(e?.message)) && !/HTTP 429/.test(String(e?.message))) throw e;
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
  }
  throw lastErr;
}

/** SQL literal for a D1-bindable value (string | number | null). */
export function sqlLiteral(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v !== 'string') throw new TypeError(`sqlLiteral: unsupported ${typeof v}`);
  if (v.includes('\u0000')) v = v.replaceAll('\u0000', '');
  return `'${v.replaceAll("'", "''")}'`;
}

export function quoteIdent(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Wrangler env: the account id from .env.local (OAuth spans several accounts). */
export function wranglerEnv() {
  const local = loadEnvLocal();
  const env = { ...process.env };
  if (!env.CLOUDFLARE_ACCOUNT_ID && local.CLOUDFLARE_ACCOUNT_ID) env.CLOUDFLARE_ACCOUNT_ID = local.CLOUDFLARE_ACCOUNT_ID;
  // .env.local's CLOUDFLARE_API_TOKEN is stale (see CLAUDE.md); use OAuth.
  delete env.CLOUDFLARE_API_TOKEN;
  return env;
}

/** Target flags for wrangler d1 commands. */
export function targetArgs(target) {
  if (target === 'remote') return ['--remote'];
  if (target === 'local') return ['--local', '--persist-to', LOCAL_PERSIST];
  throw new Error(`target must be remote or local, got ${target}`);
}

/** Runs `wrangler d1 execute` and returns the parsed --json result. */
export function d1Query(target, sql) {
  const args = [
    'wrangler', 'd1', 'execute', D1_NAME, ...targetArgs(target),
    '--config', D1_CONFIG, '--json', '--command', sql,
  ];
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = spawnSync('npx', args, { cwd: REPO, env: wranglerEnv(), encoding: 'utf8', maxBuffer: 64 << 20 });
    if (r.status === 0) {
      const start = r.stdout.indexOf('[');
      return JSON.parse(r.stdout.slice(start));
    }
    if (attempt === 4) throw new Error(`wrangler d1 execute failed: ${(r.stderr || r.stdout).slice(-800)}`);
    spawnSync('sleep', ['10']);
  }
  return [];
}

/** Runs a SQL file through wrangler with retries (D1 imports occasionally drop). */
export function d1ExecFile(target, file) {
  const args = [
    'wrangler', 'd1', 'execute', D1_NAME, ...targetArgs(target),
    '--config', D1_CONFIG, '--yes', '--file', file,
  ];
  for (let attempt = 1; attempt <= 6; attempt++) {
    const r = spawnSync('npx', args, { cwd: REPO, env: wranglerEnv(), encoding: 'utf8', maxBuffer: 64 << 20 });
    if (r.status === 0) return;
    const tail = (r.stderr || r.stdout || '')
      .replace(/\u001b\[[0-9;]*m/g, '')
      .split('\n')
      .filter((l) => l.trim() && !l.includes('Logs were written'))
      .slice(-3)
      .join('\n');
    console.warn(`  attempt ${attempt} failed:\n${tail.replace(/^/gm, '    ')}`);
    if (attempt === 6) throw new Error(`giving up on ${file}`);
    spawnSync('sleep', ['20']);
  }
}

/** Reads a JSONL file into an array (missing file -> []). */
export function readJsonl(file) {
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) if (line.trim()) out.push(JSON.parse(line));
  return out;
}
