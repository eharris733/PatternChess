// One-off: renders the landing page's brand lockup (LandingBrand: the gold
// squares + serif "Pattern" + italic gold-dark "Chess") to a transparent PNG
// that the video renderer draws. The CI runner has no Georgia, so the lockup
// is rasterized here, on a machine that does, and committed.
//
//   node scripts/social/make-wordmark.ts
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { REPO_ROOT } from './env.ts';

const OUT = join(REPO_ROOT, 'scripts', 'social', 'assets', 'wordmark.png');

// Mirrors src/components/landing/LandingBrand.tsx (h-9 mark, text-2xl, gap-2.5).
const HTML = `<!doctype html><html><body style="margin:0;background:transparent">
<div id="brand" style="display:inline-flex;align-items:center;gap:10px;padding:2px 4px">
  <svg viewBox="0 0 80 120" style="height:36px;width:36px;flex-shrink:0">
    <rect x="40" y="0" width="40" height="40" fill="#C49B2A"/>
    <rect x="40" y="40" width="40" height="40" fill="#8B6914"/>
    <rect x="40" y="80" width="40" height="40" fill="#C49B2A"/>
    <rect x="0" y="80" width="40" height="40" fill="#8B6914"/>
    <path d="M 0 80 L 80 80 M 40 0 L 40 120 M 40 40 L 80 40" stroke="#1A1A1A" stroke-width="2" fill="none"/>
    <circle cx="20" cy="100" r="5" fill="#1A1A1A"/>
    <path d="M 20 100 Q 20 50 60 20" stroke="#1A1A1A" stroke-width="2.5" stroke-dasharray="3 4" fill="none" opacity="0.85"/>
    <circle cx="60" cy="20" r="5" fill="#1A1A1A"/>
  </svg>
  <span style="font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1;letter-spacing:-0.025em;color:#1A1A1A;white-space:nowrap">Pattern<span style="font-style:italic;color:#8B6914">Chess</span></span>
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 8 });
await page.setContent(HTML);
await page.locator('#brand').screenshot({ path: OUT, omitBackground: true });
await browser.close();
console.log(OUT);
