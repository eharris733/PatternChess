#!/usr/bin/env node
// Generator for src/generated/openingBook.json — the position → opening table
// used by src/chess/openingClassifier.ts.
//
// Sources:
//   scripts/eco-tsv/{a,b,c,d,e}.tsv — copies of
//   https://github.com/lichess-org/chess-openings (CC0, public domain).
//
// Every book line is replayed to its final position and keyed by EPD (the FEN
// minus the move counters), so a game is classified by where the pieces stand
// rather than by move order — transpositions land on the same opening. Where
// two lines reach the same position the shorter (more canonical) one wins.
//
// To regenerate: refresh the TSVs in scripts/eco-tsv/ and run
//   node scripts/build-opening-book.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Chess } from 'chess.js';

const here = dirname(fileURLToPath(import.meta.url));
const tsvDir = join(here, 'eco-tsv');
const outPath = join(here, '..', 'src', 'generated', 'openingBook.json');

/** FEN minus halfmove/fullmove counters — the same key the classifier builds. */
function epdOf(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

const entries = new Map(); // epd -> { value, plies }
let maxPlies = 0;
let skipped = 0;

for (const letter of ['a', 'b', 'c', 'd', 'e']) {
  const lines = readFileSync(join(tsvDir, `${letter}.tsv`), 'utf8').split('\n');
  for (let i = 1; i < lines.length; i++) {
    const [eco, name, pgn] = (lines[i] ?? '').split('\t');
    if (!eco || !name || !pgn) continue;
    const board = new Chess();
    try {
      board.loadPgn(pgn);
    } catch {
      skipped++;
      continue;
    }
    const plies = board.history().length;
    if (plies === 0) continue;
    if (plies > maxPlies) maxPlies = plies;
    const epd = epdOf(board.fen());
    const existing = entries.get(epd);
    if (!existing || plies < existing.plies) {
      entries.set(epd, { value: `${eco}|${name}`, plies });
    }
  }
}

const out = { version: 1, maxPlies, entries: {} };
for (const epd of [...entries.keys()].sort()) out.entries[epd] = entries.get(epd).value;

writeFileSync(outPath, `${JSON.stringify(out)}\n`);
console.log(
  `openingBook.json: ${entries.size} positions, max depth ${maxPlies} plies` +
    (skipped > 0 ? `, ${skipped} unparsable lines skipped` : ''),
);
