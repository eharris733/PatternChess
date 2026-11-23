// Paths + environment for scripts/social/. Locally, .env.local supplies
// CLOUDFLARE_ACCOUNT_ID (and wrangler's OAuth login authenticates); in GitHub
// Actions every value comes from the workflow's secrets / vars.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const IN_CI = !!process.env.CI;

let cached: Record<string, string> | null = null;

/** process.env over .env.local (CI has no .env.local). */
export function env(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  if (!cached) {
    cached = {};
    const file = join(REPO_ROOT, '.env.local');
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
        if (m) cached[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
  return cached[name];
}

export function requireEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`${name} is not set (GitHub secret / .env.local)`);
  return v;
}

/**
 * `live` schedules the posts in Buffer; `draft` saves them as Buffer drafts
 * (review in Buffer, nothing publishes); anything else logs what it would do
 * (like the notifier's SEND_MODE).
 */
export function socialMode(): 'live' | 'draft' | 'dry' {
  const m = env('SOCIAL_MODE');
  return m === 'live' || m === 'draft' ? m : 'dry';
}

/** Args like `--blunder x --local --out dir`. */
export function parseArgs(argv = process.argv.slice(2)): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[a.slice(2)] = next;
      i++;
    } else out[a.slice(2)] = true;
  }
  return out;
}

/** Wrangler child-process env: CI keeps its scoped API token; locally .env.local's token is stale, so OAuth. */
export function wranglerEnv(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...process.env };
  if (!IN_CI) delete e.CLOUDFLARE_API_TOKEN;
  const account = env('CLOUDFLARE_ACCOUNT_ID');
  if (account) e.CLOUDFLARE_ACCOUNT_ID = account;
  return e;
}
