#!/usr/bin/env node
// Importer for the /learn study library.
//
//   npm run learn:sync            # fetch changed studies, rebuild outputs
//   npm run learn:sync -- --force # refetch everything
//
// Reads the hand-curated content/learn/catalog.json and, for every enabled
// entry, fetches the Lichess study PGN (or a local `pgnFile` for studies we
// author ourselves), converts every chapter to a move tree with
// src/learn/pgnToTree.ts, and writes:
//   src/generated/learn/<slug>.json   — one lazy chunk per study
//   src/generated/learnCatalog.json   — small metadata index (bundled)
//   content/learn/snapshots/<id>.pgn  — raw PGN, for reviewing diffs
//   content/learn/catalog.lock.json   — Last-Modified per study
//
// Deliberately NOT part of `npm run build`: CI must never depend on Lichess.
//
// Licensing: study text is the author's copyright (Lichess ToS grants a
// licence to Lichess only). Every enabled entry must record a `permission`,
// and a study whose export is disabled (HTTP 403) fails its entry — we never
// work around that chapter by chapter.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@mliebelt/pgn-parser';
import {
  chapterFromGame,
  isStandardChapter,
  StudyMoveError,
  type ParsedGame,
} from '../src/learn/pgnToTree.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// LEARN_CATALOG overrides the catalog (e.g. a local fixture catalog for testing the viewer).
const catalogPath = process.env.LEARN_CATALOG ?? join(root, 'content/learn/catalog.json');
const lockPath = join(root, 'content/learn/catalog.lock.json');
const snapshotDir = join(root, 'content/learn/snapshots');
const outDir = join(root, 'src/generated/learn');
const indexPath = join(root, 'src/generated/learnCatalog.json');
const bookPath = join(root, 'src/generated/openingBook.json');

const CATEGORIES = new Set(['openings', 'strategy', 'endgames']);
const LEVELS = new Set(['beginner', 'intermediate', 'advanced']);
const PERMISSION_KINDS = new Set(['author-granted', 'patternchess', 'cc-by', 'cc0']);
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

interface Permission {
  kind: string;
  note: string;
  grantedAt: string;
}

interface CatalogEntry {
  slug: string;
  studyId: string;
  title: string;
  category: string;
  openingFamilies?: string[];
  color?: 'white' | 'black' | null;
  level: string;
  author: string;
  description?: string;
  /** Chapter names or ids to keep; all chapters when omitted. */
  chapterFilter?: string[];
  /** Local PGN (repo-relative) instead of fetching from Lichess. */
  pgnFile?: string;
  permission: Permission | null;
  enabled: boolean;
}

const force = process.argv.includes('--force');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback;
}

function openingFamilies(): Set<string> {
  const book = readJson<{ entries: Record<string, string> }>(bookPath, { entries: {} });
  const out = new Set<string>();
  for (const v of Object.values(book.entries)) {
    const name = v.split('|')[1] ?? '';
    out.add((name.split(':')[0] ?? name).trim());
  }
  return out;
}

function validate(e: CatalogEntry, families: Set<string>): string[] {
  const errs: string[] = [];
  if (!SLUG_RE.test(e.slug)) errs.push(`bad slug "${e.slug}"`);
  if (!CATEGORIES.has(e.category)) errs.push(`bad category "${e.category}"`);
  if (!LEVELS.has(e.level)) errs.push(`bad level "${e.level}"`);
  if (!e.author) errs.push('missing author (credited on every page)');
  if (!e.permission || !PERMISSION_KINDS.has(e.permission.kind) || !e.permission.note) {
    errs.push('missing permission — record how reuse was licensed before enabling');
  }
  for (const f of e.openingFamilies ?? []) {
    if (!families.has(f)) errs.push(`unknown opening family "${f}" (must match games.opening_family)`);
  }
  if (e.category === 'openings' && (e.openingFamilies ?? []).length === 0) {
    errs.push('opening studies need openingFamilies so /openings can suggest them');
  }
  return errs;
}

async function lichessFetch(url: string, init?: RequestInit): Promise<Response> {
  // Lichess asks for one request at a time and a minute's pause after a 429.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 429) return res;
    console.warn('  429 from Lichess — waiting 60s');
    await sleep(60_000);
  }
  throw new Error('rate limited by Lichess');
}

async function fetchStudyPgn(
  e: CatalogEntry,
  lock: Record<string, { lastModified: string | null }>,
): Promise<{ pgn: string; lastModified: string | null } | 'unchanged'> {
  if (e.pgnFile) return { pgn: readFileSync(join(root, e.pgnFile), 'utf8'), lastModified: null };

  const base = `https://lichess.org/api/study/${e.studyId}.pgn`;
  const head = await lichessFetch(base, { method: 'HEAD' });
  const lastModified = head.headers.get('last-modified');
  const built = existsSync(join(outDir, `${e.slug}.json`));
  if (!force && built && lastModified && lock[e.studyId]?.lastModified === lastModified) {
    return 'unchanged';
  }
  const res = await lichessFetch(
    `${base}?comments=true&variations=true&orientation=true&clocks=false`,
  );
  if (res.status === 403) {
    throw new Error('export disabled by the author (403) — ask them to allow export, or drop the entry');
  }
  if (res.status === 404) throw new Error('study not found or private (404)');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { pgn: await res.text(), lastModified };
}

function keepChapter(e: CatalogEntry, id: string, name: string): boolean {
  return !e.chapterFilter || e.chapterFilter.includes(id) || e.chapterFilter.includes(name);
}

async function main() {
  const catalog = readJson<{ studies: CatalogEntry[] }>(catalogPath, { studies: [] });
  const lock = readJson<Record<string, { lastModified: string | null; builtAt: string }>>(lockPath, {});
  const families = openingFamilies();
  mkdirSync(outDir, { recursive: true });
  mkdirSync(snapshotDir, { recursive: true });

  const index: unknown[] = [];
  let failed = 0;
  const slugs = new Set<string>();

  for (const e of catalog.studies) {
    if (!e.enabled) continue;
    console.log(`• ${e.slug} (${e.studyId})`);
    if (slugs.has(e.slug)) {
      console.error(`  ✗ duplicate slug`);
      failed++;
      continue;
    }
    slugs.add(e.slug);
    const errs = validate(e, families);
    if (errs.length > 0) {
      for (const err of errs) console.error(`  ✗ ${err}`);
      failed++;
      continue;
    }

    try {
      const fetched = await fetchStudyPgn(e, lock);
      let study: Record<string, unknown>;
      if (fetched === 'unchanged') {
        console.log('  unchanged since last sync');
        study = readJson(join(outDir, `${e.slug}.json`), {});
      } else {
        if (!e.pgnFile) writeFileSync(join(snapshotDir, `${e.studyId}.pgn`), fetched.pgn);
        const games = parse(fetched.pgn, { startRule: 'games' }) as unknown as ParsedGame[];
        const chapterData = [];
        for (const [i, g] of games.entries()) {
          if (!isStandardChapter(g)) continue;
          try {
            const ch = chapterFromGame(g, i);
            // Divider / title chapters with no moves add nothing to the viewer.
            if (ch.moves.length === 0 && !ch.intro) continue;
            if (keepChapter(e, ch.id, ch.name)) chapterData.push(ch);
          } catch (err) {
            if (!(err instanceof StudyMoveError)) throw err;
            console.warn(`  ! skipped chapter ${i + 1}: ${err.message}`);
          }
        }
        if (chapterData.length === 0) throw new Error('no usable chapters');
        study = {
          slug: e.slug,
          studyId: e.studyId,
          title: e.title,
          category: e.category,
          openingFamilies: e.openingFamilies ?? [],
          color: e.color ?? null,
          level: e.level,
          author: e.author,
          authorUrl: `https://lichess.org/@/${e.author}`,
          studyUrl: `https://lichess.org/study/${e.studyId}`,
          description: e.description ?? '',
          permissionNote: e.permission!.note,
          chapters: chapterData.map((c) => ({ id: c.id, name: c.name })),
          chapterData,
        };
        writeFileSync(join(outDir, `${e.slug}.json`), JSON.stringify(study));
        lock[e.studyId] = { lastModified: fetched.lastModified, builtAt: new Date().toISOString() };
        console.log(`  ✓ ${chapterData.length} chapters`);
      }
      const { chapterData: _omit, ...meta } = study;
      index.push(meta);
    } catch (err) {
      console.error(`  ✗ ${(err as Error).message}`);
      failed++;
      // Keep serving the last good build rather than dropping the study.
      const previous = join(outDir, `${e.slug}.json`);
      if (existsSync(previous)) {
        const { chapterData: _omit, ...meta } = readJson<Record<string, unknown>>(previous, {});
        index.push(meta);
        console.error('    (kept the previous build)');
      }
    }
    if (!e.pgnFile) await sleep(1_000);
  }

  // Generated files are owned by this script: drop studies that were disabled
  // or removed from the catalog so they stop being bundled.
  // A failed fetch keeps its last good build (it just isn't in this index).
  const keep = new Set([...slugs].map((slug) => `${slug}.json`));
  for (const f of readdirSync(outDir)) {
    if (f.endsWith('.json') && !keep.has(f)) {
      rmSync(join(outDir, f));
      console.log(`- removed stale ${f}`);
    }
  }

  writeFileSync(indexPath, `${JSON.stringify({ version: 1, studies: index }, null, 2)}\n`);
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`\n${index.length} studies in the library${failed ? `, ${failed} failed` : ''}.`);
  if (failed) process.exitCode = 1;
}

await main();
