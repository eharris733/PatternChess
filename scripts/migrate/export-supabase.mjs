#!/usr/bin/env node
// Exports every public table plus auth users (with identities) from Supabase
// into data/migrate/*.jsonl (gitignored) for import-d1.mjs. READ-ONLY on
// Supabase: GET requests only.
//
//   npm run migrate:export            # everything
//   node scripts/migrate/export-supabase.mjs games blunders   # some tables
//
// Reads VITE_SUPABASE_URL + SUPABASE_SERVICE_KEY from .env.local (the service
// key bypasses RLS). Tables page through PostgREST 1000 rows at a time with
// keyset paging on the primary key (stable while the app keeps writing);
// users page through the GoTrue admin API. Writes data/migrate/manifest.json
// with the row counts.
import { createWriteStream, mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { APP_TABLES, DATA_DIR, EXPORT_ORDER, fetchRetry, supabaseCreds } from './lib.mjs';

const PAGE = 1000;
const { url, key } = supabaseCreds();
const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' };

mkdirSync(DATA_DIR, { recursive: true });

function writer(name) {
  const final = join(DATA_DIR, `${name}.jsonl`);
  const tmp = `${final}.tmp`;
  const stream = createWriteStream(tmp);
  return {
    write: (row) => stream.write(`${JSON.stringify(row)}\n`),
    close: () =>
      new Promise((resolve, reject) => {
        stream.end((err) => {
          if (err) return reject(err);
          renameSync(tmp, final);
          resolve();
        });
      }),
  };
}

/** Exact row count via PostgREST (HEAD + Prefer: count=exact). */
async function remoteCount(table) {
  const res = await fetchRetry(
    `${url}/rest/v1/${table}?select=*&limit=1`,
    { method: 'HEAD', headers: { ...headers, Prefer: 'count=exact' } },
    `count ${table}`,
  );
  const range = res.headers.get('content-range') ?? '';
  const total = Number(range.split('/')[1]);
  return Number.isFinite(total) ? total : null;
}

async function exportTable({ name, pk }) {
  const out = writer(name);
  let n = 0;
  if (pk.length === 1) {
    const col = pk[0];
    let last = null;
    for (;;) {
      const filter = last === null ? '' : `&${col}=gt.${encodeURIComponent(last)}`;
      const res = await fetchRetry(
        `${url}/rest/v1/${name}?select=*&order=${col}.asc&limit=${PAGE}${filter}`,
        { headers },
        `export ${name}`,
      );
      const rows = await res.json();
      for (const r of rows) out.write(r);
      n += rows.length;
      if (rows.length < PAGE) break;
      last = rows[rows.length - 1][col];
      if (process.stdout.isTTY) process.stdout.write(`\r  ${name}: ${n}`);
    }
  } else {
    const order = pk.map((c) => `${c}.asc`).join(',');
    for (let offset = 0; ; offset += PAGE) {
      const res = await fetchRetry(
        `${url}/rest/v1/${name}?select=*&order=${order}&limit=${PAGE}&offset=${offset}`,
        { headers },
        `export ${name}`,
      );
      const rows = await res.json();
      for (const r of rows) out.write(r);
      n += rows.length;
      if (rows.length < PAGE) break;
    }
  }
  await out.close();
  return n;
}

async function exportUsers() {
  // The list endpoint omits identities and email_confirmed_at, so list ids
  // first, then read each user in full (GET /admin/users/:id).
  const ids = [];
  for (let page = 1; ; page++) {
    const res = await fetchRetry(
      `${url}/auth/v1/admin/users?page=${page}&per_page=${PAGE}`,
      { headers },
      'list auth users',
    );
    const body = await res.json();
    const users = Array.isArray(body) ? body : body.users ?? [];
    for (const u of users) ids.push(u.id);
    if (users.length < PAGE) break;
  }
  const full = new Array(ids.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < ids.length) {
        const i = next++;
        const res = await fetchRetry(`${url}/auth/v1/admin/users/${ids[i]}`, { headers }, 'read auth user');
        full[i] = await res.json();
      }
    }),
  );
  const out = writer('auth_users');
  let identities = 0;
  for (const u of full) {
    out.write(u);
    identities += (u.identities ?? []).length;
  }
  await out.close();
  return { n: full.length, identities };
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const byName = new Map(APP_TABLES.map((t) => [t.name, t]));
for (const t of only) if (t !== 'auth_users' && !byName.has(t)) throw new Error(`unknown table ${t}`);
const want = (t) => only.length === 0 || only.includes(t);

const manifestFile = join(DATA_DIR, 'manifest.json');
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : { tables: {} };
manifest.startedAt = new Date().toISOString();
manifest.source = new URL(url).host;

console.log(`Exporting from ${manifest.source} into ${DATA_DIR}`);
const rows = [];
for (const name of EXPORT_ORDER) {
  if (!want(name)) continue;
  const exported = await exportTable(byName.get(name));
  const count = await remoteCount(name);
  manifest.tables[name] = { exported, remoteCountAfter: count, at: new Date().toISOString() };
  if (process.stdout.isTTY) process.stdout.write('\r');
  rows.push({ table: name, exported, supabase_now: count, note: count === exported ? '' : 'changed during export' });
}
if (want('auth_users')) {
  const { n, identities } = await exportUsers();
  manifest.tables.auth_users = { exported: n, identities, at: new Date().toISOString() };
  rows.push({ table: 'auth_users', exported: n, supabase_now: null, note: `${identities} identities` });
}
manifest.finishedAt = new Date().toISOString();
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.table(rows);
