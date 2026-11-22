// SQL against the app D1 (`patternchess-app`) for the ad scripts, through
// `wrangler d1 execute` (Node only — nothing here reaches the page).
//   local (default): the copy scripts/dev-api.sh serves (.wrangler/state)
//   remote: the real D1; needs CLOUDFLARE_ACCOUNT_ID in .env.local
// The wrangler CLI can't bind parameters, so quote values with sqlString().
import { execFileSync } from 'node:child_process';
import { loadEnv, REPO_ROOT } from './env.ts';

export interface D1Options {
  remote?: boolean;
}

export function sqlString(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

export function d1<T = Record<string, unknown>>(sql: string, opts: D1Options = {}): T[] {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // .env.local's CLOUDFLARE_API_TOKEN is stale (CLAUDE.md); use wrangler's OAuth login.
  delete env.CLOUDFLARE_API_TOKEN;
  if (opts.remote) {
    const account = loadEnv().CLOUDFLARE_ACCOUNT_ID;
    if (account) env.CLOUDFLARE_ACCOUNT_ID = account;
  }
  const args = [
    'wrangler', 'd1', 'execute', 'patternchess-app',
    opts.remote ? '--remote' : '--local',
    '--config', 'd1/wrangler.jsonc',
    ...(opts.remote ? [] : ['--persist-to', '.wrangler/state']),
    '--json', '--command', sql,
  ];
  const out = execFileSync('npx', args, { cwd: REPO_ROOT, env, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  const parsed = JSON.parse(out) as Array<{ results: T[] }>;
  return parsed[0]?.results ?? [];
}
