import { describe, expect, it } from 'vitest';
import { formatClock, isFillerNote, matchNote, noteSquares, parseClock, type TranscriptSegment } from './transcriptMatch';

const segs: TranscriptSegment[] = [
  { start: 100, end: 108, text: 'after D takes e4 white captures now black once again can' },
  { start: 108, end: 116, text: 'branch out but the main move is Bishop to F 5 challenging the knight' },
  { start: 300, end: 308, text: 'the pawn structure tells you the plan so learn it well' },
];

describe('transcriptMatch', () => {
  it('parses and formats clocks', () => {
    expect(parseClock('2:46')).toBe(166);
    expect(parseClock('1:02:03')).toBe(3723);
    expect(parseClock('90')).toBe(90);
    expect(formatClock(166)).toBe('2:46');
    expect(formatClock(3723)).toBe('1:02:03');
  });

  it('finds squares in prose and SAN', () => {
    expect(noteSquares('After 3...dxe4 4.Nxe4 Bf5 the bishop eyes c2.').sort()).toEqual(['c2', 'e4', 'f5']);
  });

  it('passes a note whose square is spoken nearby, including "F 5"', () => {
    const m = matchNote('4...Bf5 hits the knight.', 110, segs);
    expect(m.ok).toBe(true);
    expect(m.matched).toContain('f5');
  });

  it('fails a note whose squares are not spoken near its timestamp', () => {
    expect(matchNote('Now 5.h4 threatens h5.', 110, segs).ok).toBe(false);
    // Right words, wrong moment.
    expect(matchNote('4...Bf5 hits the knight.', 600, segs).ok).toBe(false);
  });

  it('matches square-free notes on content words', () => {
    expect(matchNote('The structure tells you the plan.', 302, segs).ok).toBe(true);
    expect(matchNote('Develop quickly and castle early.', 302, segs).ok).toBe(false);
  });
});

describe('isFillerNote', () => {
  it('flags notes that only name the move', () => {
    for (const n of ['Knight to f3.', '...Ke7.', 'White castles.', 'The bishop retreats to h7.', 'Black takes on d4.', 'The most common continuation.']) {
      expect(isFillerNote(n), n).toBe(true);
    }
  });
  it('keeps notes that say why', () => {
    for (const n of ['Pinning the knight to the king.', 'Take it. Draw.', 'h4 threatens to trap the bishop with h5.', 'Black takes on d4, opening the c-file.']) {
      expect(isFillerNote(n), n).toBe(false);
    }
  });
});
