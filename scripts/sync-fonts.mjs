#!/usr/bin/env node
// Copies the self-hosted latin woff2 files from @fontsource into public/fonts.
// The files are committed; rerun this only when bumping the @fontsource
// devDependencies. Keep the list in sync with src/styles/fonts.css and the
// <link rel="preload"> tags in index.html.

import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'public', 'fonts');
mkdirSync(out, { recursive: true });

const FILES = [
  ...[400, 500, 600, 700].map((w) => ['inter', `inter-latin-${w}-normal.woff2`]),
  ...[400, 500, 600].map((w) => ['jetbrains-mono', `jetbrains-mono-latin-${w}-normal.woff2`]),
];

for (const [pkg, file] of FILES) {
  copyFileSync(join(root, 'node_modules', '@fontsource', pkg, 'files', file), join(out, file));
  console.log(`  fonts: ${file}`);
}
