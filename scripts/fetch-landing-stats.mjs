#!/usr/bin/env node
// Snapshots the public `landing_stats` RPC into src/generated/landingStats.json
// at build time. The landing page renders the social-proof card from this
// snapshot immediately (and in the prerendered HTML), then swaps in live
// numbers once the RPC resolves — so the card no longer pops into the layout
// ~1.3 s after paint (that insertion alone was a 0.20 CLS on mobile).
//
// Never fails the build: on any error the committed snapshot is kept.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outPath = join(root, 'src', 'generated', 'landingStats.json');

function loadEnv() {
  const env = { ...process.env };
  const envFile = join(root, '.env.local');
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.warn('fetch-landing-stats: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set, keeping snapshot');
    return;
  }
  const res = await fetch(`${url}/rest/v1/rpc/landing_stats`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (typeof data?.positionsReviewed !== 'number' || typeof data?.eloGained !== 'number') {
    throw new Error(`unexpected payload ${JSON.stringify(data).slice(0, 200)}`);
  }
  const snapshot = {
    positionsReviewed: data.positionsReviewed,
    eloGained: data.eloGained,
    computedAt: String(data.computedAt ?? new Date().toISOString()),
  };
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`fetch-landing-stats: ${snapshot.positionsReviewed} positions, +${snapshot.eloGained} elo`);
}

main().catch((err) => {
  console.warn(`fetch-landing-stats: ${err.message} — keeping existing snapshot`);
});
