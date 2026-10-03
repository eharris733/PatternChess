// Pulls the real numbers the stat card shows. Read-only (service key, Node only).
//   eloGained / positionsReviewed — the public landing_stats RPC (same as the landing page)
//   retention — of users who have trained at least once: % still training
//   7+ / 30+ days after signup (by training_sessions.local_date).
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './env.ts';

const env = loadEnv();
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const { data: landing, error: landingErr } = await sb.rpc('landing_stats');
if (landingErr) throw landingErr;

const [{ data: profiles, error: pErr }, sessions] = await Promise.all([
  sb.from('profiles').select('id, created_at'),
  fetchAll('training_sessions', 'user_id, local_date, blunders_attempted'),
]);
if (pErr) throw pErr;

const createdAt = new Map(profiles!.map((p) => [p.id, new Date(p.created_at as string).getTime()]));
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
  eloGained: (landing as { eloGained: number }).eloGained,
  positionsReviewed: (landing as { positionsReviewed: number }).positionsReviewed,
  trainedUsers: trained.length,
  retentionReturnPct: pct(returned, trained.length),
  retentionWeek2Pct: pct(trained.filter(([, u]) => u.week2).length, trained.length),
  retentionDay30Pct: pct(eligible30.filter(([, u]) => u.d30).length, eligible30.length),
  avgActiveDays: +(trained.reduce((a, [, u]) => a + u.days.size, 0) / (trained.length || 1)).toFixed(1),
  computedAt: new Date().toISOString(),
};
writeFileSync(new URL('./stats.json', import.meta.url), JSON.stringify(stats, null, 2) + '\n');
console.log(stats);

async function fetchAll(table: string, select: string) {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(select).range(from, from + 999);
    if (error) throw error;
    rows.push(...data!);
    if (data!.length < 1000) return rows;
  }
}
