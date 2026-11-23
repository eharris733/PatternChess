#!/usr/bin/env node
// Snapshots the public `landing.stats` RPC into src/generated/landingStats.json
// at build time. The landing page renders the social-proof card from this
// snapshot immediately (and in the prerendered HTML), then swaps in live
// numbers once the RPC resolves — so the card no longer pops into the layout
// ~1.3 s after paint (that insertion alone was a 0.20 CLS on mobile).
//
// Also snapshots `leaderboard.public` (weekly top 5) into
// src/generated/landingLeaderboard.json for the same reason.
//
// Both are anonymous RPCs on the Pages Functions API (POST /api/rpc/<name>).
// Base URL: LANDING_STATS_BASE_URL (env or .env.local), default
// https://patternchess.com — e.g. http://localhost:8788 for `scripts/dev-api.sh`.
//
// Never fails the build: on any error the committed snapshot is kept.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outPath = join(root, 'src', 'generated', 'landingStats.json');
const leaderboardOutPath = join(root, 'src', 'generated', 'landingLeaderboard.json');
const DEFAULT_BASE_URL = 'https://patternchess.com';

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
  const base = (env.LANDING_STATS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  await Promise.all([
    fetchStats(base).catch((err) =>
      console.warn(`fetch-landing-stats: ${err.message} — keeping existing snapshot`),
    ),
    fetchLeaderboard(base).catch((err) =>
      console.warn(`fetch-landing-stats: leaderboard ${err.message} — keeping existing snapshot`),
    ),
  ]);
}

async function rpc(base, name) {
  const res = await fetch(`${base}/api/rpc/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const body = await res.json();
  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new Error(`${name}: unexpected response ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body.data;
}

async function fetchLeaderboard(base) {
  const data = await rpc(base, 'leaderboard.public');
  if (!Array.isArray(data?.rows)) {
    throw new Error(`unexpected payload ${JSON.stringify(data).slice(0, 200)}`);
  }
  const snapshot = {
    since: typeof data.since === 'string' ? data.since : null,
    computedAt: String(data.computedAt ?? new Date().toISOString()),
    rows: data.rows.slice(0, 5).map((r) => ({
      rank: Number(r.rank),
      label: String(r.label),
      platform: r.platform === 'lichess' || r.platform === 'chesscom' ? r.platform : null,
      rating: typeof r.rating === 'number' ? r.rating : null,
      ratingCategory: typeof r.ratingCategory === 'string' ? r.ratingCategory : null,
      value: Number(r.value),
      flair: typeof r.flair === 'string' && r.flair ? r.flair : null,
    })),
  };
  writeFileSync(leaderboardOutPath, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`fetch-landing-stats: leaderboard ${snapshot.rows.length} rows`);
}

async function fetchStats(base) {
  const data = await rpc(base, 'landing.stats');
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
