// Motivational articles for /path.
//
//   content/supporter/articles/*.md   sources (gitignored: this repo is public)
//   src/generated/articles.json       public titles + teasers (committed, bundled)
//   KV patternchess-content           `article:<slug>` → rendered HTML, served to
//                                     supporters by functions/api/articles/[slug].ts
//
//   npm run articles:sync            write the JSON and upload bodies to KV
//   npm run articles:sync -- --dry   write the JSON only
//
// Run by hand, never in `build`. Only `status: approved` articles are synced;
// drafts are skipped, and bodies of articles no longer approved are deleted
// from KV. The markdown is uploaded too (`article-md:<slug>`) as a backup.

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import matter from 'gray-matter';
import MarkdownIt from 'markdown-it';

const KV_NAMESPACE_ID = 'd4683ee908184d24a880ed39b4ebedaf';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'content', 'supporter', 'articles');
const out = join(root, 'src', 'generated', 'articles.json');
const dry = process.argv.includes('--dry');
const md = new MarkdownIt({ html: false, linkify: false, typographer: true });

if (!existsSync(dir)) throw new Error(`${dir} not found (article sources are gitignored; restore them first)`);

const articles = readdirSync(dir)
  .filter((f) => f.endsWith('.md'))
  .sort()
  .map((file) => {
    const { data, content } = matter(readFileSync(join(dir, file), 'utf8'));
    for (const key of ['slug', 'title', 'unlockAt', 'status']) {
      if (data[key] == null) throw new Error(`${file}: missing "${key}"`);
    }
    if (!/^[a-z0-9-]{1,80}$/.test(String(data.slug))) throw new Error(`${file}: slug must be a-z, 0-9, -`);
    const firstPara = content.trim().split(/\n\s*\n/)[0];
    return {
      slug: String(data.slug),
      title: String(data.title),
      unlockAt: Number(data.unlockAt),
      status: String(data.status),
      teaserHtml: md.renderInline(firstPara),
      bodyHtml: md.render(content),
      markdown: content,
    };
  });

const approved = articles.filter((a) => a.status === 'approved');
for (const a of articles) if (a.status !== 'approved') console.log(`  skip ${a.status}: ${a.slug}`);

writeFileSync(
  out,
  JSON.stringify(
    approved.map(({ slug, title, unlockAt, teaserHtml }) => ({ slug, title, unlockAt, teaserHtml })),
    null,
    2,
  ) + '\n',
);
console.log(`wrote ${approved.length} approved article(s) to src/generated/articles.json`);
if (dry) process.exit(0);

const wrangler = (...args) =>
  execFileSync('npx', ['wrangler', 'kv', ...args, '--namespace-id', KV_NAMESPACE_ID, '--remote'], {
    cwd: root,
    encoding: 'utf8',
  });

const tmp = mkdtempSync(join(tmpdir(), 'pc-articles-'));
if (approved.length > 0) {
  const entries = approved.flatMap((a) => [
    { key: `article:${a.slug}`, value: a.bodyHtml },
    { key: `article-md:${a.slug}`, value: a.markdown },
  ]);
  writeFileSync(join(tmp, 'put.json'), JSON.stringify(entries));
  wrangler('bulk', 'put', join(tmp, 'put.json'));
}

const listed = JSON.parse(wrangler('key', 'list', '--prefix', 'article'));
const keep = new Set(approved.flatMap((a) => [`article:${a.slug}`, `article-md:${a.slug}`]));
const stale = listed.map((k) => k.name).filter((name) => !keep.has(name));
if (stale.length > 0) {
  writeFileSync(join(tmp, 'delete.json'), JSON.stringify(stale));
  wrangler('bulk', 'delete', join(tmp, 'delete.json'), '--force');
}
console.log(`synced ${approved.length} article(s) to KV; removed ${stale.length} stale key(s)`);
