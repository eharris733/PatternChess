#!/usr/bin/env node
// Prerenders the public routes to static HTML so crawlers and (JS-blind) AI
// answer engines get real body content + per-route <head> without executing JS.
//
// How it works: serve the built dist/ with `vite preview`, drive it with the
// already-installed Playwright Chromium, and snapshot document.documentElement
// for each public route into dist/<route>/index.html.
//
// Notes:
//  - The app uses createRoot (not hydrateRoot), so on load React simply
//    re-renders over the prerendered markup — no hydration-mismatch class of
//    bugs. The static HTML is for first paint + crawlers; the live app takes over.
//  - dist/index.html is overwritten with the prerendered home page. It also
//    remains the SPA fallback (public/_redirects: /* /index.html 200), so gated
//    routes still boot the client app and RequireAuth redirects as before.
//  - We wait on the canonical <link> matching the target path, not just any
//    <h1>: the preview server serves the fallback HTML for not-yet-written
//    routes, so a bare h1 wait could snapshot the wrong route before the client
//    router navigates.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { preview } from 'vite';
import { chromium } from '@playwright/test';
import { readPublishedPosts } from './lib/posts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const distDir = join(root, 'dist');

const routes = [
  '/',
  '/about',
  '/faq',
  '/blog',
  '/terms',
  '/privacy',
  ...readPublishedPosts().map((p) => `/blog/${p.slug}`),
];

const server = await preview({ root, preview: { port: 4173, strictPort: true } });
const base = server.resolvedUrls.local[0].replace(/\/$/, '');

let failures = 0;
try {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  for (const route of routes) {
    try {
      await page.goto(base + route, { waitUntil: 'load', timeout: 20000 });
      // Wait until the client router has rendered THIS route (its canonical link
      // resolves to the expected path), not merely some h1 from the fallback.
      await page.waitForFunction(
        (expected) => {
          const link = document.querySelector('link[rel="canonical"]');
          if (!link) return false;
          try {
            return new URL(link.href).pathname === expected;
          } catch {
            return false;
          }
        },
        route,
        { timeout: 15000 },
      );
      await page.waitForSelector('main h1, article h1', { timeout: 5000 });

      const html = await page.evaluate(
        () => '<!doctype html>\n' + document.documentElement.outerHTML,
      );
      // Emit flat "<route>.html" files (not "<route>/index.html") so Cloudflare
      // Pages serves them at clean, non-trailing-slash URLs that match our
      // canonical/sitemap entries (/about, /blog/<slug>). Home stays index.html.
      const outPath =
        route === '/' ? join(distDir, 'index.html') : join(distDir, `${route}.html`);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, html);
      console.log(`  prerendered ${route}  (${(html.length / 1024).toFixed(0)} kB)`);
    } catch (err) {
      console.error(`  FAILED ${route}: ${err.message}`);
      failures++;
    }
  }

  await browser.close();
} finally {
  await server.close();
}

if (failures) {
  console.error(`prerender: ${failures} route(s) failed`);
  process.exit(1);
}
console.log(`prerender: wrote ${routes.length} static pages`);
