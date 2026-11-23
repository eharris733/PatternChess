// D1, KV and R2 through the wrangler CLI (no extra SDK; same approach as
// marketing/ad/d1.ts). D1 defaults to the local copy that scripts/dev-api.sh
// serves; pass { remote: true } (the --remote flag) for the real database.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeRow } from '../../functions/_shared/schema.ts';
import { env, REPO_ROOT, wranglerEnv } from './env.ts';

export const R2_BUCKET = 'patternchess-social';
export const MEDIA_BASE_URL = 'https://social.patternchess.com';

export interface Target {
  remote: boolean;
}

function wrangler(args: string[], input?: string): string {
  return execFileSync('npx', ['wrangler', ...args], {
    cwd: REPO_ROOT,
    env: wranglerEnv(),
    encoding: 'utf8',
    input,
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** SQL literal (wrangler can't bind parameters). */
export function sql(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`non-finite number in SQL: ${v}`);
    return String(v);
  }
  return `'${v.replace(/'/g, "''")}'`;
}

export function d1<T = Record<string, unknown>>(query: string, target: Target, decodeAs?: string): T[] {
  const out = wrangler([
    'd1', 'execute', 'patternchess-app',
    target.remote ? '--remote' : '--local',
    '--config', 'd1/wrangler.jsonc',
    ...(target.remote ? [] : ['--persist-to', '.wrangler/state']),
    '--json', '--command', query,
  ]);
  const parsed = JSON.parse(out) as Array<{ results: Record<string, unknown>[] }>;
  const rows = parsed[0]?.results ?? [];
  return (decodeAs ? rows.map((r) => decodeRow(decodeAs, r)) : rows) as T[];
}

// --- KV (tokens) ------------------------------------------------------------
// The namespace id comes from SOCIAL_KV_NAMESPACE_ID; locally the store is the
// .wrangler/state copy unless --remote.

function kvArgs(target: Target): string[] {
  const id = env('SOCIAL_KV_NAMESPACE_ID');
  if (!id) throw new Error('SOCIAL_KV_NAMESPACE_ID is not set');
  return ['--namespace-id', id, target.remote ? '--remote' : '--local', ...(target.remote ? [] : ['--persist-to', '.wrangler/state'])];
}

export function kvGet(key: string, target: Target): string | null {
  try {
    const out = wrangler(['kv', 'key', 'get', key, '--text', ...kvArgs(target)]).trim();
    // A missing key prints "Value not found" and exits 0.
    return out && out !== 'Value not found' ? out : null;
  } catch (e) {
    const msg = String((e as { stderr?: string }).stderr ?? e);
    if (/not found|404/i.test(msg)) return null;
    throw e;
  }
}

export function kvPut(key: string, value: string, target: Target): void {
  // Values go through a temp file so a token never lands in the process list.
  const dir = mkdtempSync(join(tmpdir(), 'pc-kv-'));
  try {
    const file = join(dir, 'v');
    writeFileSync(file, value, { mode: 0o600 });
    wrangler(['kv', 'key', 'put', key, '--path', file, ...kvArgs(target)]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function kvGetJson<T>(key: string, target: Target): T | null {
  const raw = kvGet(key, target);
  return raw ? (JSON.parse(raw) as T) : null;
}

export function kvPutJson(key: string, value: unknown, target: Target): void {
  kvPut(key, JSON.stringify(value), target);
}

// --- R2 (media) --------------------------------------------------------------

/** Uploads a file and returns its public URL. Always the real bucket (Instagram must fetch it). */
export function r2Put(localPath: string, key: string, contentType: string): string {
  wrangler([
    'r2', 'object', 'put', `${R2_BUCKET}/${key}`,
    '--file', localPath,
    '--content-type', contentType,
    '--cache-control', 'public, max-age=31536000, immutable',
    '--remote',
  ]);
  return `${MEDIA_BASE_URL}/${key}`;
}
