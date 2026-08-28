#!/usr/bin/env node
// Generates SEO/AIEO artifacts into dist/ after `vite build`:
//   robots.txt, sitemap.xml, rss.xml, llms.txt, llms-full.txt
//
// Reads blog posts via the shared reader so URLs/dates stay in sync with the
// site. Run as a build step (see package.json) — writes only to dist/.

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readPublishedPosts } from './lib/posts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, '..', 'dist');

// Keep in sync with src/seo/siteMeta.ts.
const SITE_URL = 'https://patternchess.com';
const SITE_NAME = 'PatternChess';
const SITE_DESCRIPTION =
  'PatternChess turns the blunders from your own chess games into spaced-repetition drills, using the Woodpecker Method so you stop making the same mistakes twice.';

// Routes a crawler should index. Gated app routes and /p are excluded.
const STATIC_ROUTES = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/blog', changefreq: 'weekly', priority: '0.8' },
  { path: '/about', changefreq: 'monthly', priority: '0.7' },
  { path: '/faq', changefreq: 'monthly', priority: '0.7' },
  { path: '/events', changefreq: 'monthly', priority: '0.7' },
  { path: '/terms', changefreq: 'yearly', priority: '0.3' },
  { path: '/privacy', changefreq: 'yearly', priority: '0.3' },
];

// Paths kept out of search via robots.txt (gated app + per-share puzzle links).
const DISALLOW = [
  '/dashboard',
  '/training',
  '/vault',
  '/profile',
  '/achievements',
  '/analytics',
  '/p',
];

// AI answer engines we explicitly welcome (each gets the same disallow set so
// they avoid gated routes but are never blocked from public content).
const AI_BOTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'anthropic-ai',
  'Claude-Web',
  'PerplexityBot',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
];

const xmlEscape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function main() {
  if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });
  const posts = readPublishedPosts();
  const today = new Date().toISOString().slice(0, 10);

  // --- robots.txt ---
  const group = (ua) => ['User-agent: ' + ua, 'Allow: /', ...DISALLOW.map((d) => 'Disallow: ' + d)].join('\n');
  const robots =
    '# PatternChess robots.txt — AI answer engines are explicitly welcome.\n\n' +
    [group('*'), ...AI_BOTS.map(group)].join('\n\n') +
    `\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
  writeFileSync(join(distDir, 'robots.txt'), robots);

  // --- sitemap.xml ---
  const urlTag = (loc, lastmod, changefreq, priority) =>
    `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
  const urls = [
    ...STATIC_ROUTES.map((r) => urlTag(SITE_URL + r.path, today, r.changefreq, r.priority)),
    ...posts.map((p) =>
      urlTag(`${SITE_URL}/blog/${p.slug}`, p.updated || p.date, 'monthly', '0.6'),
    ),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
  writeFileSync(join(distDir, 'sitemap.xml'), sitemap);

  // --- rss.xml ---
  const items = posts
    .map(
      (p) =>
        `    <item>\n      <title>${xmlEscape(p.title)}</title>\n      <link>${SITE_URL}/blog/${p.slug}</link>\n      <guid>${SITE_URL}/blog/${p.slug}</guid>\n      <pubDate>${new Date(`${p.date}T00:00:00Z`).toUTCString()}</pubDate>\n      <description>${xmlEscape(p.description)}</description>\n    </item>`,
    )
    .join('\n');
  const rss = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>${xmlEscape(SITE_NAME)} Blog</title>\n    <link>${SITE_URL}/blog</link>\n    <description>${xmlEscape(SITE_DESCRIPTION)}</description>\n    <language>en-us</language>\n${items}\n  </channel>\n</rss>\n`;
  writeFileSync(join(distDir, 'rss.xml'), rss);

  // --- llms.txt (curated index for AI crawlers) ---
  const llms =
    `# ${SITE_NAME}\n\n> ${SITE_DESCRIPTION}\n\n` +
    `## Core pages\n` +
    `- [Home](${SITE_URL}/): What PatternChess is and how it trains the blunders from your own games.\n` +
    `- [About & glossary](${SITE_URL}/about): What the app is, the Woodpecker Method, and definitions of blunder, spaced repetition, and winning chances.\n` +
    `- [FAQ](${SITE_URL}/faq): Answers to common questions about PatternChess and chess improvement.\n\n` +
    `## Blog\n` +
    posts.map((p) => `- [${p.title}](${SITE_URL}/blog/${p.slug}): ${p.description}`).join('\n') +
    '\n';
  writeFileSync(join(distDir, 'llms.txt'), llms);

  // --- llms-full.txt (full post text for agents that fetch it) ---
  const llmsFull =
    `# ${SITE_NAME}\n\n> ${SITE_DESCRIPTION}\n\n` +
    posts.map((p) => `# ${p.title}\n\n${p.markdown}`).join('\n\n---\n\n') +
    '\n';
  writeFileSync(join(distDir, 'llms-full.txt'), llmsFull);

  console.log(
    `gen-seo: wrote robots.txt, sitemap.xml (${STATIC_ROUTES.length + posts.length} urls), rss.xml, llms.txt, llms-full.txt`,
  );
}

main();
