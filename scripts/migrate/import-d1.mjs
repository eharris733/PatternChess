#!/usr/bin/env node
// Loads data/migrate/*.jsonl (from export-supabase.mjs) into the D1 database
// patternchess-app. See d1/README.md.
//
//   npm run migrate:import -- --remote --fresh     # full reload (cutover)
//   node scripts/migrate/import-d1.mjs --local --fresh
//
//   --remote | --local   target (one is required; --local uses .wrangler/state,
//                        the same store `wrangler pages dev` reads)
//   --fresh              delete every row first (children first, then the
//                        better-auth tables), so a re-run is a clean reload
//   --sql-only           write data/migrate/sql/*.sql and stop
//   --resume-from N      skip generated files numbered below N (after a failed
//                        run; inserts are ON CONFLICT DO NOTHING, so re-running
//                        a half-applied file is safe)
//
// Every value is a SQL literal (no bound params, so D1's 100-param limit does
// not apply); statements stay under ~90 KB (D1 caps one at 100 KB) and files
// at ~8 MB. Insert order is FK-safe: user, account, profiles (referred_by in a
// second pass), games, blunders, then the rest.
//
// Users: better-auth `user.id` = Supabase auth.users.id. Email = the real
// (lowercased) email, or `<lichessId>@lichess.invalid` for email-less Lichess
// sign-ins. `account`: one row per Supabase identity, id = identity_id,
// providerId 'google' | 'lichess', accountId = the provider's subject
// (Google `sub`; Lichess account id = lowercased username, what
// https://lichess.org/api/account returns as `id`).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeRow, toIsoTimestamp } from '../../functions/_shared/schema.ts';
import {
  DATA_DIR,
  DELETE_ORDER,
  IMPORT_ORDER,
  d1ExecFile,
  d1Query,
  quoteIdent,
  readJsonl,
  sqlLiteral,
} from './lib.mjs';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const target = flag('--remote') ? 'remote' : flag('--local') ? 'local' : null;
const sqlOnly = flag('--sql-only');
const fresh = flag('--fresh');
const resumeIdx = args.indexOf('--resume-from');
const resumeFrom = resumeIdx >= 0 ? Number(args[resumeIdx + 1]) : 0;
if (!target && !sqlOnly) {
  console.error('usage: import-d1.mjs (--remote | --local) [--fresh] [--resume-from N] | --sql-only');
  process.exit(1);
}

const MAX_STMT = 90_000;
const MAX_FILE = 8_000_000;
const SQL_DIR = join(DATA_DIR, 'sql');
const PLACEHOLDER_DOMAIN = 'lichess.invalid';

// ---------------------------------------------------------------------------
// Users + accounts
// ---------------------------------------------------------------------------

const PROVIDER_MAP = { google: 'google', 'custom:lichess': 'lichess' };

function buildAuth(authUsers) {
  const users = [];
  const accounts = [];
  const problems = [];
  for (const u of authUsers) {
    const meta = u.user_metadata ?? {};
    const identities = u.identities ?? [];
    const lichess = identities.find((i) => i.provider === 'custom:lichess');
    const realEmail = (u.email ?? '').trim().toLowerCase();
    let email = realEmail;
    if (!email && lichess) email = `${String(lichess.id).toLowerCase()}@${PLACEHOLDER_DOMAIN}`;
    if (!email) {
      email = `${u.id}@no-email.invalid`;
      problems.push(`user ${u.id}: no email and no Lichess identity`);
    }
    const name =
      meta.full_name || meta.name || meta.preferred_username || meta.user_name || realEmail.split('@')[0] || 'Player';
    const createdAt = toIsoTimestamp(u.created_at);
    users.push({
      id: u.id,
      name: String(name),
      email,
      // The auth layer derives the provider from this without a DB read:
      // placeholder email -> lichess, emailVerified = 1 -> google, else
      // email/password. So every Google user is 1 (Google only hands out
      // verified emails) and every Lichess placeholder user is 0.
      emailVerified: identities.some((i) => i.provider === 'google') && realEmail ? 1 : 0,
      image: meta.avatar_url || meta.picture || null,
      createdAt,
      updatedAt: u.updated_at ? toIsoTimestamp(u.updated_at) : createdAt,
    });
    for (const i of identities) {
      const providerId = PROVIDER_MAP[i.provider];
      if (!providerId) {
        problems.push(`user ${u.id}: skipped identity with provider ${i.provider}`);
        continue;
      }
      // GoTrue's identity `id` is the provider subject (= identity_data.sub).
      const subject = String(i.identity_data?.sub ?? i.id);
      const iCreated = i.created_at ? toIsoTimestamp(i.created_at) : createdAt;
      accounts.push({
        id: i.identity_id ?? `${providerId}:${subject}`,
        accountId: providerId === 'lichess' ? subject.toLowerCase() : subject,
        providerId,
        userId: u.id,
        createdAt: iCreated,
        updatedAt: i.updated_at ? toIsoTimestamp(i.updated_at) : iCreated,
      });
    }
  }
  return { users, accounts, problems };
}

// ---------------------------------------------------------------------------
// App rows: FK filtering (drop or null dangling refs, mirroring ON DELETE)
// ---------------------------------------------------------------------------

function filterRows(data, userIds) {
  const report = {};
  const note = (t, msg) => ((report[t] ??= {})[msg] = (report[t]?.[msg] ?? 0) + 1);

  data.profiles = data.profiles.filter((r) => userIds.has(r.id) || (note('profiles', 'dropped: no user'), false));
  const profileIds = new Set(data.profiles.map((r) => r.id));
  // referred_by goes in a second pass (self-reference).
  const referrals = [];
  for (const r of data.profiles) {
    if (r.referred_by && profileIds.has(r.referred_by)) referrals.push([r.id, r.referred_by]);
    else if (r.referred_by) note('profiles', 'referred_by nulled: referrer missing');
    r.referred_by = null;
  }

  // ON DELETE SET NULL to user
  for (const t of ['games', 'blunders']) {
    for (const r of data[t]) {
      if (r.user_id && !userIds.has(r.user_id)) {
        r.user_id = null;
        note(t, 'user_id nulled: user missing');
      }
    }
  }
  const gameIds = new Set(data.games.map((r) => r.id));
  data.blunders = data.blunders.filter(
    (r) => !r.game_id || gameIds.has(r.game_id) || (note('blunders', 'dropped: game missing'), false),
  );
  const blunderIds = new Set(data.blunders.map((r) => r.id));
  for (const t of ['endgame_scenarios', 'opening_deviations']) {
    data[t] = data[t].filter((r) => {
      if (!userIds.has(r.user_id)) return note(t, 'dropped: user missing'), false;
      if (!gameIds.has(r.game_id)) return note(t, 'dropped: game missing'), false;
      if (r.blunder_id && !blunderIds.has(r.blunder_id)) {
        r.blunder_id = null;
        note(t, 'blunder_id nulled: blunder missing');
      }
      return true;
    });
  }
  data.game_annotations = data.game_annotations.filter((r) => {
    if (!gameIds.has(r.game_id)) return note('game_annotations', 'dropped: game missing'), false;
    if (r.user_id && !userIds.has(r.user_id)) return note('game_annotations', 'dropped: user missing'), false;
    return true;
  });
  // Postgres allowed one annotation row per (game, user); D1 has UNIQUE(game_id).
  const seenGames = new Set();
  data.game_annotations = data.game_annotations
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .filter((r) => !seenGames.has(r.game_id) && seenGames.add(r.game_id));
  for (const t of ['repertoire_moves', 'training_sessions', 'supporters', 'email_sends', 'email_confirmations']) {
    data[t] = data[t].filter((r) => userIds.has(r.user_id) || (note(t, 'dropped: user missing'), false));
  }
  return { referrals, report };
}

// ---------------------------------------------------------------------------
// SQL generation
// ---------------------------------------------------------------------------

class SqlFiles {
  constructor() {
    this.files = [];
    this.cur = null;
    this.seq = 0;
  }
  start(label) {
    this.flush();
    this.cur = { label, parts: [], size: 0 };
  }
  add(stmt) {
    if (!this.cur) this.start('misc');
    if (this.cur.size + stmt.length > MAX_FILE && this.cur.parts.length) {
      const label = this.cur.label;
      this.flush();
      this.cur = { label, parts: [], size: 0 };
    }
    this.cur.parts.push(stmt);
    this.cur.size += stmt.length + 1;
  }
  flush() {
    if (!this.cur || !this.cur.parts.length) return;
    this.seq++;
    const file = join(SQL_DIR, `${String(this.seq).padStart(3, '0')}-${this.cur.label}.sql`);
    writeFileSync(file, `${this.cur.parts.join('\n')}\n`);
    this.files.push({ seq: this.seq, file });
    this.cur = null;
  }
}

/** Multi-row INSERT … ON CONFLICT DO NOTHING statements, each < MAX_STMT bytes. */
function* insertStatements(table, rows) {
  if (!rows.length) return;
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const head = `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(', ')}) VALUES\n`;
  const tail = '\nON CONFLICT DO NOTHING;';
  let batch = [];
  let size = head.length + tail.length;
  for (const r of rows) {
    const tuple = `(${cols.map((c) => sqlLiteral(r[c] ?? null)).join(', ')})`;
    if (tuple.length + head.length + tail.length > MAX_STMT) {
      throw new Error(`${table} row ${r.id ?? ''} is ${tuple.length} bytes; too big for one D1 statement`);
    }
    if (batch.length && size + tuple.length + 2 > MAX_STMT) {
      yield head + batch.join(',\n') + tail;
      batch = [];
      size = head.length + tail.length;
    }
    batch.push(tuple);
    size += tuple.length + 2;
  }
  if (batch.length) yield head + batch.join(',\n') + tail;
}

function freshStatements(counts) {
  const out = [];
  for (const t of DELETE_ORDER) {
    const n = counts[t] ?? 0;
    // Chunked so no single statement runs into D1's per-query time limit.
    const chunks = Math.ceil(n / 5000) + (n ? 1 : 0);
    for (let i = 0; i < chunks; i++) {
      out.push(`DELETE FROM ${quoteIdent(t)} WHERE rowid IN (SELECT rowid FROM ${quoteIdent(t)} LIMIT 5000);`);
    }
  }
  return out;
}

function countRows(target, tables) {
  const sql = `SELECT ${tables.map((t) => `(SELECT count(*) FROM ${quoteIdent(t)}) AS ${quoteIdent(t)}`).join(', ')}`;
  return d1Query(target, sql)[0].results[0];
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const data = {};
for (const t of IMPORT_ORDER) data[t] = readJsonl(join(DATA_DIR, `${t}.jsonl`));
const authUsers = readJsonl(join(DATA_DIR, 'auth_users.jsonl'));
if (!authUsers.length) throw new Error('data/migrate/auth_users.jsonl is empty; run npm run migrate:export first');

const { users, accounts, problems } = buildAuth(authUsers);
const userIds = new Set(users.map((u) => u.id));
const { referrals, report } = filterRows(data, userIds);
for (const p of problems) console.warn(`! ${p}`);
for (const [t, msgs] of Object.entries(report)) for (const [m, n] of Object.entries(msgs)) console.warn(`! ${t}: ${m} (${n})`);

rmSync(SQL_DIR, { recursive: true, force: true });
mkdirSync(SQL_DIR, { recursive: true });
const files = new SqlFiles();

if (fresh && !sqlOnly) {
  const counts = countRows(target, DELETE_ORDER);
  const stmts = freshStatements(counts);
  if (stmts.length) {
    files.start('fresh');
    for (const s of stmts) files.add(s);
  }
}

files.start('user');
for (const s of insertStatements('user', users.map((u) => encodeRow('user', u)))) files.add(s);
files.start('account');
for (const s of insertStatements('account', accounts.map((a) => encodeRow('account', a)))) files.add(s);

const expected = { user: users.length, account: accounts.length };
for (const t of IMPORT_ORDER) {
  const rows = data[t];
  expected[t] = rows.length;
  if (!rows.length) continue;
  files.start(t);
  // encodeRow: booleans -> 0/1, jsonb/text[] -> JSON text, timestamptz -> ISO
  // UTC ms, games.time_category from time_control.
  for (const s of insertStatements(t, rows.map((r) => encodeRow(t, r)))) files.add(s);
  if (t === 'profiles' && referrals.length) {
    files.start('profiles-referrals');
    for (const [id, ref] of referrals) {
      files.add(`UPDATE profiles SET referred_by = ${sqlLiteral(ref)} WHERE id = ${sqlLiteral(id)};`);
    }
  }
}
files.flush();
writeFileSync(join(SQL_DIR, 'expected-counts.json'), `${JSON.stringify(expected, null, 2)}\n`);
console.log(`Wrote ${files.files.length} SQL files to ${SQL_DIR}`);
if (sqlOnly) process.exit(0);

for (const { seq, file } of files.files) {
  if (seq < resumeFrom) continue;
  const t0 = Date.now();
  process.stdout.write(`→ ${file.split('/').pop()} … `);
  d1ExecFile(target, file);
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

const actual = countRows(target, Object.keys(expected));
const rows = Object.keys(expected).map((t) => ({
  table: t,
  expected: expected[t],
  d1: actual[t],
  ok: expected[t] === actual[t] ? 'yes' : 'NO',
}));
console.table(rows);
if (rows.some((r) => r.ok !== 'yes')) {
  console.error('Row counts differ (rows already in D1 before a non --fresh run also count).');
  process.exitCode = 1;
}
