// Reads .env.local for the ad scripts (Node only — nothing here reaches the page).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

export function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(`${root}.env.local`, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

export const REPO_ROOT = root;
export const AD_EMAIL = process.env.AD_EMAIL ?? 'elliotmharris@gmail.com';
export const BASE_URL = process.env.AD_BASE_URL ?? 'http://localhost:5173';
