// Pulls the real numbers the stat card shows. Read-only (Node only).
//   eloGained / positionsReviewed — the public landing.stats RPC (same as the landing page)
//   retention — of users who have trained at least once: % still training
//   7+ / 30+ days after signup (by training_sessions.local_date).
// Reads the app D1: local copy by default, `--remote` for the real one. The
// RPC comes from AD_API_URL (default http://localhost:8788, scripts/dev-api.sh;
// use https://patternchess.com with --remote after the cutover).
import { writeFileSync } from 'node:fs';
import { d1 } from './d1.ts';

const remote = process.argv.includes('--remote');
const api = (process.env.AD_API_URL ?? 'http://localhost:8788').replace(/\/$/, '');

const res = await fetch(`${api}/api/rpc/landing.stats`, { method: 'POST' });
const body = (await res.json()) as { data?: { eloGained: number; positionsReviewed: number }; error?: unknown };
if (!res.ok || !body.data) throw new Error(`landing.stats failed: ${res.status} ${JSON.stringify(body.error)}`);
const landing = body.data;

const profiles = d1<{ id: string; created_at: string }>('SELECT id, created_at FROM profiles', { remote });
const sessions = d1<{ user_id: string; local_date: string; blunders_attempted: number }>(
  'SELECT user_id, local_date, blunders_attempted FROM training_sessions',
  { remote },
);

const createdAt = new Map(profiles.map((p) => [p.id, new Date(p.created_at as string).getTime()]));
const DAY = 86_400_000;
const perUser = new Map<string, { days: Set<string>; week2: boolean; d30: boolean }>();
for (const s of sessions) {
  if (!s.blunders_attempted) continue;
  const joined = createdAt.get(s.user_id);
  if (joined === undefined) continue;
  const u = perUser.get(s.user_id) ?? { days: new Set(), week2: false, d30: false };
  const offset = (new Date(s.local_date).getTime() - joined) / DAY;
  u.days.add(s.local_date);
  if (offset >= 7) u.week2 = true;
  if (offset >= 30) u.d30 = true;
  perUser.set(s.user_id, u);
}
const trained = [...perUser.entries()];
const eligible30 = trained.filter(([id]) => Date.now() - createdAt.get(id)! > 30 * DAY);
// "Come back to train": trained on at least two different days.
const returned = trained.filter(([, u]) => u.days.size >= 2).length;
const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);

const stats = {
  eloGained: landing.eloGained,
  positionsReviewed: landing.positionsReviewed,
  trainedUsers: trained.length,
  retentionReturnPct: pct(returned, trained.length),
  retentionWeek2Pct: pct(trained.filter(([, u]) => u.week2).length, trained.length),
  retentionDay30Pct: pct(eligible30.filter(([, u]) => u.d30).length, eligible30.length),
  avgActiveDays: +(trained.reduce((a, [, u]) => a + u.days.size, 0) / (trained.length || 1)).toFixed(1),
  computedAt: new Date().toISOString(),
};
writeFileSync(new URL('./stats.json', import.meta.url), JSON.stringify(stats, null, 2) + '\n');
console.log(stats);

