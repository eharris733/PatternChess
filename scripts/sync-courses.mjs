// Personalised YouTube courses (/courses).
//
//   content/courses/catalog.json         public catalog: every course, its topic,
//                                         creator, permission, days 1-2 in full and
//                                         the titles of the later days (committed)
//   content/supporter/courses/<slug>.json days 3+ (youtubeId/start/end/takeaway),
//                                         gitignored: this repo is public
//   src/generated/courses-catalog.json   what the app bundles (committed)
//   KV patternchess-content              `course-day:<slug>:<n>` → JSON day content,
//                                         served to supporters by the
//                                         courses.dayContent RPC
//
//   npm run courses:sync                 write the JSON and upload days 3+ to KV
//   npm run courses:sync -- --dry        write the JSON only
//   npm run courses:sync -- --local      write the JSON and fill the local KV
//                                         (.wrangler/state or $STATE, for scripts/dev-api.sh)
//
// Run by hand, never in `build`. Every course is synced whatever its
// permission status; the app shows only `granted` courses in production
// builds (pending ones in dev and on the preview environment).

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const KV_NAMESPACE_ID = 'd4683ee908184d24a880ed39b4ebedaf';
const KEY_PREFIX = 'course-day:';
const PHASES = ['opening', 'middlegame', 'endgame'];
const PERMISSION_STATUSES = ['granted', 'pending', 'declined'];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = join(root, 'content', 'courses', 'catalog.json');
const supporterDir = join(root, 'content', 'supporter', 'courses');
const out = join(root, 'src', 'generated', 'courses-catalog.json');
const dry = process.argv.includes('--dry');
const local = process.argv.includes('--local');

// Label sources stay in TS; read their keys from the source text.
function keysOf(file, constName) {
  const text = readFileSync(join(root, file), 'utf8');
  const m = new RegExp(`${constName}[^=]*=\\s*([\\[{][\\s\\S]*?[\\]}]);`).exec(text);
  if (!m) throw new Error(`${constName} not found in ${file}`);
  return new Set([...m[1].matchAll(/^\s*'?([A-Za-z-]+)'?\s*[:,]/gm)].map((x) => x[1]));
}
const MOTIFS = keysOf('src/chess/motifs.ts', 'export const MOTIF_LABEL');
const ENDGAME_TYPES = keysOf('src/chess/endgameType.ts', 'export const ENDGAME_TYPE_LABEL');
const FAMILIES = new Set(
  Object.values(JSON.parse(readFileSync(join(root, 'src', 'generated', 'openingBook.json'), 'utf8')).entries).map((v) => {
    const name = String(v).split('|')[1] ?? '';
    return (name.split(':')[0] ?? name).trim();
  }),
);

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const freeDays = Number(catalog.freeDays);
if (!Number.isInteger(freeDays) || freeDays < 0) throw new Error('catalog.freeDays must be a whole number');

const fail = (slug, msg) => {
  throw new Error(`${slug}: ${msg}`);
};

function checkSegment(slug, n, d) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(String(d.youtubeId ?? ''))) fail(slug, `day ${n} needs an 11-character youtubeId`);
  for (const k of ['start', 'end']) {
    if (d[k] != null && !(Number.isInteger(d[k]) && d[k] >= 0)) fail(slug, `day ${n} ${k} must be whole seconds`);
  }
  if (d.start != null && d.end != null && d.end <= d.start) fail(slug, `day ${n} ends before it starts`);
  if (!String(d.takeaway ?? '').trim()) fail(slug, `day ${n} needs a takeaway`);
  return {
    youtubeId: d.youtubeId,
    ...(d.start != null ? { start: d.start } : {}),
    ...(d.end != null ? { end: d.end } : {}),
    takeaway: String(d.takeaway).trim(),
  };
}

const seen = new Set();
const kvEntries = [];
const courses = catalog.courses.map((c) => {
  const slug = String(c.slug ?? '');
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) fail(slug || '(no slug)', 'slug must be a-z, 0-9, -');
  if (seen.has(slug)) fail(slug, 'duplicate slug');
  seen.add(slug);
  for (const k of ['title', 'summary']) if (!String(c[k] ?? '').trim()) fail(slug, `missing ${k}`);
  if (!c.creator?.name || !/^https:\/\/(www\.)?youtube\.com\//.test(c.creator?.channelUrl ?? '')) {
    fail(slug, 'creator needs a name and a youtube.com channelUrl');
  }
  if (!PERMISSION_STATUSES.includes(c.permission?.status)) fail(slug, `permission.status must be ${PERMISSION_STATUSES.join(' | ')}`);

  const t = c.topic ?? {};
  if (!Array.isArray(t.keys) || t.keys.length === 0) fail(slug, 'topic.keys must be a non-empty array');
  const known = { opening: FAMILIES, motif: MOTIFS, phase: new Set(PHASES) }[t.type];
  if (!known) fail(slug, `topic.type must be opening | motif | phase`);
  for (const k of t.keys) if (!known.has(k)) fail(slug, `unknown ${t.type} key "${k}"`);
  if (t.color != null && t.color !== 'white' && t.color !== 'black') fail(slug, 'topic.color must be white | black');
  if (t.endgameType != null && !ENDGAME_TYPES.has(t.endgameType)) fail(slug, `unknown endgameType "${t.endgameType}"`);

  const supporterFile = join(supporterDir, `${slug}.json`);
  const locked = existsSync(supporterFile) ? JSON.parse(readFileSync(supporterFile, 'utf8')).days ?? {} : null;
  if (!Array.isArray(c.days) || c.days.length === 0) fail(slug, 'needs days');

  const days = c.days.map((d, i) => {
    const n = i + 1;
    if (!String(d.title ?? '').trim()) fail(slug, `day ${n} needs a title`);
    if (n <= freeDays) return { day: n, title: d.title.trim(), ...checkSegment(slug, n, d) };
    if (d.youtubeId || d.takeaway) fail(slug, `day ${n} is supporter-only: move its video and takeaway to content/supporter/courses/${slug}.json`);
    if (!locked) fail(slug, `content/supporter/courses/${slug}.json is missing (gitignored; restore it first)`);
    if (!locked[String(n)]) fail(slug, `content/supporter/courses/${slug}.json has no day ${n}`);
    kvEntries.push({ key: `${KEY_PREFIX}${slug}:${n}`, value: JSON.stringify(checkSegment(slug, n, locked[String(n)])) });
    return { day: n, title: d.title.trim(), locked: true };
  });
  if (locked) {
    for (const n of Object.keys(locked)) {
      if (Number(n) <= freeDays || Number(n) > days.length) fail(slug, `content/supporter/courses/${slug}.json has an extra day ${n}`);
    }
  }

  return {
    slug,
    title: c.title.trim(),
    summary: c.summary.trim(),
    topic: {
      type: t.type,
      keys: t.keys,
      ...(t.color ? { color: t.color } : {}),
      ...(t.endgameType ? { endgameType: t.endgameType } : {}),
    },
    creator: { name: c.creator.name, channelUrl: c.creator.channelUrl },
    permission: { status: c.permission.status, date: c.permission.date ?? null },
    days,
  };
});

// Supporter files for courses no longer in the catalog are a mistake worth flagging.
if (existsSync(supporterDir)) {
  for (const f of readdirSync(supporterDir).filter((n) => n.endsWith('.json'))) {
    if (!seen.has(f.replace(/\.json$/, ''))) console.warn(`  warning: ${f} has no catalog entry`);
  }
}

writeFileSync(out, JSON.stringify({ freeDays, courses }, null, 2) + '\n');
const granted = courses.filter((c) => c.permission.status === 'granted').length;
console.log(`wrote ${courses.length} course(s) (${granted} granted) to src/generated/courses-catalog.json`);
if (dry) process.exit(0);

const wrangler = (...args) =>
  execFileSync(
    'npx',
    ['wrangler', 'kv', ...args, '--namespace-id', KV_NAMESPACE_ID, ...(local ? ['--local', '--persist-to', process.env.STATE ?? '.wrangler/state'] : ['--remote'])],
    { cwd: root, encoding: 'utf8' },
  );

const tmp = mkdtempSync(join(tmpdir(), 'pc-courses-'));
if (kvEntries.length > 0) {
  writeFileSync(join(tmp, 'put.json'), JSON.stringify(kvEntries));
  wrangler('bulk', 'put', join(tmp, 'put.json'));
}
const listed = JSON.parse(wrangler('key', 'list', '--prefix', KEY_PREFIX));
const keep = new Set(kvEntries.map((e) => e.key));
const stale = listed.map((k) => k.name).filter((name) => !keep.has(name));
if (stale.length > 0) {
  writeFileSync(join(tmp, 'delete.json'), JSON.stringify(stale));
  wrangler('bulk', 'delete', join(tmp, 'delete.json'), '--force');
}
console.log(`synced ${kvEntries.length} supporter day(s) to ${local ? 'local' : 'remote'} KV; removed ${stale.length} stale key(s)`);
