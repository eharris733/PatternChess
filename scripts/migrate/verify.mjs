#!/usr/bin/env node
// Verifies a D1 copy against live Supabase (read-only there):
//   1. per-table row counts, Supabase (exact count) vs D1
//   2. 3 sampled rows per non-empty table, fetched from both and compared
//      after decodeRow (booleans, JSON arrays/objects, timestamps truncated
//      to ms, numbers)
//   3. every Supabase user has a better-auth user + exactly one account row
//      with the right providerId/accountId; email/emailVerified rules hold
//
//   node scripts/migrate/verify.mjs --remote | --local
import { isDeepStrictEqual } from 'node:util';
import { TABLES, decodeRow, timeCategory, toIsoTimestamp } from '../../functions/_shared/schema.ts';
import { APP_TABLES, d1Query, fetchRetry, quoteIdent, supabaseCreds } from './lib.mjs';

const target = process.argv.includes('--remote') ? 'remote' : process.argv.includes('--local') ? 'local' : null;
if (!target) {
  console.error('usage: verify.mjs --remote | --local');
  process.exit(1);
}
const { url, key } = supabaseCreds();
const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' };
let failures = 0;
const fail = (msg) => {
  failures++;
  console.error(`✗ ${msg}`);
};

async function sbCount(table) {
  const res = await fetchRetry(
    `${url}/rest/v1/${table}?select=*&limit=1`,
    { method: 'HEAD', headers: { ...headers, Prefer: 'count=exact' } },
    `count ${table}`,
  );
  return Number((res.headers.get('content-range') ?? '').split('/')[1]);
}
async function sbGet(path) {
  const res = await fetchRetry(`${url}${path}`, { headers }, path);
  return res.json();
}
const d1 = (sql) => d1Query(target, sql).flatMap((r) => r.results);

// 1. counts -------------------------------------------------------------
const d1Counts = d1(
  `SELECT ${APP_TABLES.map((t) => `(SELECT count(*) FROM ${quoteIdent(t.name)}) AS ${quoteIdent(t.name)}`).join(', ')},
          (SELECT count(*) FROM user) AS auth_users, (SELECT count(*) FROM account) AS auth_identities`,
)[0];
const authList = [];
for (let page = 1; ; page++) {
  const body = await sbGet(`/auth/v1/admin/users?page=${page}&per_page=1000`);
  const users = body.users ?? body;
  authList.push(...users);
  if (users.length < 1000) break;
}
const countRows = [];
for (const { name } of APP_TABLES) {
  const sb = await sbCount(name);
  countRows.push({ table: name, supabase: sb, d1: d1Counts[name], match: sb === d1Counts[name] ? 'yes' : 'NO' });
}
countRows.push({
  table: 'auth.users -> user',
  supabase: authList.length,
  d1: d1Counts.auth_users,
  match: authList.length === d1Counts.auth_users ? 'yes' : 'NO',
});
console.table(countRows);
for (const r of countRows) if (r.match !== 'yes') fail(`count mismatch ${r.table}: supabase ${r.supabase}, d1 ${r.d1}`);

// 2. spot checks ---------------------------------------------------------
function normalize(table, row) {
  const s = TABLES[table];
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = s.ts.includes(k) && typeof v === 'string' ? toIsoTimestamp(v) : v;
  }
  return out;
}
const samples = [];
for (const { name, pk } of APP_TABLES) {
  if (!d1Counts[name]) continue;
  // 3 rows: first, middle and last by primary key.
  const order = pk.join(', ');
  const n = d1Counts[name];
  const offsets = [...new Set([0, Math.floor(n / 2), n - 1])];
  for (const off of offsets) {
    const [raw] = d1(`SELECT * FROM ${quoteIdent(name)} ORDER BY ${order} LIMIT 1 OFFSET ${off}`);
    const ours = normalize(name, decodeRow(name, raw));
    const filter = pk.map((c) => `${c}=eq.${encodeURIComponent(String(raw[c]))}`).join('&');
    const [theirs] = await sbGet(`/rest/v1/${name}?select=*&${filter}`);
    if (!theirs) {
      fail(`${name} ${pk.map((c) => raw[c]).join('/')}: missing in Supabase (deleted since export?)`);
      continue;
    }
    const expected = normalize(name, theirs);
    if (name === 'games') expected.time_category = timeCategory(theirs.time_control);
    const diffs = Object.keys({ ...expected, ...ours }).filter((k) => !isDeepStrictEqual(expected[k], ours[k]));
    const id = pk.map((c) => raw[c]).join('/');
    if (diffs.length) {
      // Live rows can legitimately change after the export (SR updates etc.).
      fail(`${name} ${id}: differs in ${diffs.join(', ')}`);
      for (const k of diffs.slice(0, 4)) {
        console.error(`    ${k}: supabase=${JSON.stringify(expected[k])?.slice(0, 120)} d1=${JSON.stringify(ours[k])?.slice(0, 120)}`);
      }
    }
    const s = TABLES[name];
    const kinds = [
      ...s.bool.filter((c) => ours[c] !== null && ours[c] !== undefined).map((c) => `${c}=${ours[c]}`),
      ...s.json.filter((c) => ours[c] !== null && ours[c] !== undefined).map((c) => `${c}:${Array.isArray(ours[c]) ? 'array' : typeof ours[c]}`),
    ];
    samples.push({ table: name, id: id.slice(0, 36), fields: Object.keys(ours).length, equal: diffs.length ? 'NO' : 'yes', typed: kinds.slice(0, 4).join(' ') });
  }
}
console.table(samples);

// 3. users + accounts -----------------------------------------------------
const users = d1('SELECT id, email, emailVerified, name FROM user');
const accounts = d1('SELECT userId, providerId, accountId FROM account');
const byUser = new Map();
for (const a of accounts) byUser.set(a.userId, [...(byUser.get(a.userId) ?? []), a]);
const usersById = new Map(users.map((u) => [u.id, u]));
const stats = { google: 0, lichess: 0, placeholderEmails: 0 };
for (const su of authList) {
  const full = await sbGet(`/auth/v1/admin/users/${su.id}`);
  const ident = full.identities?.[0];
  const u = usersById.get(su.id);
  const accs = byUser.get(su.id) ?? [];
  if (!u) {
    fail(`user ${su.id} missing in D1`);
    continue;
  }
  if (accs.length !== 1) fail(`user ${su.id} has ${accs.length} account rows`);
  const a = accs[0];
  if (ident?.provider === 'google') {
    stats.google++;
    if (a?.providerId !== 'google' || a?.accountId !== ident.identity_data.sub) fail(`google account mismatch for ${su.id}`);
    if (u.email !== full.email.toLowerCase() || u.emailVerified !== 1) fail(`google user ${su.id} email/emailVerified wrong`);
  } else if (ident?.provider === 'custom:lichess') {
    stats.lichess++;
    const lid = String(ident.identity_data.sub).toLowerCase();
    if (a?.providerId !== 'lichess' || a?.accountId !== lid) fail(`lichess account mismatch for ${su.id}`);
    if (u.email !== `${lid}@lichess.invalid` || u.emailVerified !== 0) fail(`lichess user ${su.id} email wrong`);
    stats.placeholderEmails++;
  } else {
    fail(`user ${su.id}: unexpected identity ${ident?.provider}`);
  }
}
const extra = users.filter((u) => !authList.some((s) => s.id === u.id));
if (extra.length) console.warn(`! ${extra.length} D1 users not in Supabase (created after the import?)`);
console.table([{ ...stats, accounts: accounts.length, usersWithOneAccount: [...byUser.values()].filter((v) => v.length === 1).length }]);

console.log(failures ? `\n${failures} problem(s)` : '\nAll checks passed');
process.exitCode = failures ? 1 : 0;
