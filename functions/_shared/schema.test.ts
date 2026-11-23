import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  APP_TABLES,
  TABLES,
  decodeRow,
  decodeRows,
  encodeRow,
  timeCategory,
  toIsoTimestamp,
} from './schema';

describe('decodeRow', () => {
  it('turns 0/1 into booleans and parses JSON columns', () => {
    const row = decodeRow('blunders', {
      id: 'b1',
      last_drill_failed: 1,
      correct_moves: '["e2e4","d2d4"]',
      motifs: '[]',
      solution_line: null,
      drill_data: '{"source":"book"}',
      cycle_number: 2,
      next_drill_at: '2026-11-22T03:16:41.851Z',
    });
    expect(row).toEqual({
      id: 'b1',
      last_drill_failed: true,
      correct_moves: ['e2e4', 'd2d4'],
      motifs: [],
      solution_line: null,
      drill_data: { source: 'book' },
      cycle_number: 2,
      next_drill_at: '2026-11-22T03:16:41.851Z',
    });
  });

  it('keeps nullable booleans null and only touches present keys', () => {
    expect(decodeRow('games', { rated: null })).toEqual({ rated: null });
    expect(decodeRow('games', { id: 'g', rated: 0 })).toEqual({ id: 'g', rated: false });
    expect(decodeRow('profiles', { id: 'p' })).toEqual({ id: 'p' });
  });

  it('leaves malformed JSON text alone', () => {
    expect(decodeRow('games', { clock_per_ply: 'not json' })).toEqual({ clock_per_ply: 'not json' });
  });

  it('decodes text[] columns as arrays', () => {
    const p = decodeRow<{ preferred_time_controls: string[]; email_opt_in: boolean }>('profiles', {
      preferred_time_controls: '["blitz","rapid"]',
      email_opt_in: 1,
    });
    expect(p.preferred_time_controls).toEqual(['blitz', 'rapid']);
    expect(p.email_opt_in).toBe(true);
  });

  it('decodeRows maps every row', () => {
    expect(decodeRows('supporters', [{ cancel_at_period_end: 0 }, { cancel_at_period_end: 1 }])).toEqual([
      { cancel_at_period_end: false },
      { cancel_at_period_end: true },
    ]);
  });

  it('throws on an unknown table', () => {
    expect(() => decodeRow('nope', {})).toThrow(/unknown table/);
  });
});

describe('encodeRow', () => {
  it('is the inverse of decodeRow', () => {
    const decoded = {
      id: 'b1',
      last_drill_failed: false,
      correct_moves: ['e2e4'],
      motifs: ['fork', 'pin'],
      drill_data: null,
      next_drill_at: '2026-11-22T03:16:41.851Z',
      eval_swing: -320,
    };
    const encoded = encodeRow('blunders', decoded);
    expect(encoded).toEqual({
      id: 'b1',
      last_drill_failed: 0,
      correct_moves: '["e2e4"]',
      motifs: '["fork","pin"]',
      drill_data: null,
      next_drill_at: '2026-11-22T03:16:41.851Z',
      eval_swing: -320,
    });
    expect(decodeRow('blunders', encoded)).toEqual(decoded);
  });

  it('drops undefined keys and normalizes timestamps', () => {
    expect(
      encodeRow('training_sessions', {
        id: 's',
        ended_at: undefined,
        started_at: '2026-11-22T04:38:20.034104+00:00',
      }),
    ).toEqual({ id: 's', started_at: '2026-11-22T04:38:20.034Z' });
    expect(encodeRow('supporters', { updated_at: new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6)) })).toEqual({
      updated_at: '2026-01-02T03:04:05.006Z',
    });
  });

  it('fills games.time_category from time_control', () => {
    expect(encodeRow('games', { time_control: '300+3' }).time_category).toBe('blitz');
    expect(encodeRow('games', { time_control: null }).time_category).toBeNull();
    expect(encodeRow('games', { time_control: '60', time_category: 'rapid' }).time_category).toBe('rapid');
    expect('time_category' in encodeRow('games', { pgn: 'x' })).toBe(false);
  });

  it('rejects objects in non-JSON columns', () => {
    expect(() => encodeRow('games', { pgn: { a: 1 } })).toThrow(TypeError);
  });

  it('JSON-encodes string values in JSON columns', () => {
    expect(encodeRow('landing_stats_cache', { payload: 'x' }).payload).toBe('"x"');
  });
});

describe('toIsoTimestamp', () => {
  it.each([
    ['2026-11-22T04:38:20.034104+00:00', '2026-11-22T04:38:20.034Z'],
    ['2026-11-22T04:38:20+00:00', '2026-11-22T04:38:20.000Z'],
    ['2026-11-22 04:38:20.5+00', '2026-11-22T04:38:20.500Z'],
    ['2026-11-22T04:38:20.999999-05:00', '2026-11-22T09:38:20.999Z'],
    ['2026-11-22T04:38:20.851Z', '2026-11-22T04:38:20.851Z'],
    ['2026-11-22T04:38', '2026-11-22T04:38:00.000Z'],
  ])('%s -> %s', (input, expected) => {
    expect(toIsoTimestamp(input)).toBe(expected);
  });

  it('passes through unparseable strings', () => {
    expect(toIsoTimestamp('2026-11-22')).toBe('2026-11-22');
    expect(toIsoTimestamp('garbage')).toBe('garbage');
  });

  it('accepts epoch ms', () => {
    expect(toIsoTimestamp(0)).toBe('1970-01-01T00:00:00.000Z');
  });
});

describe('timeCategory', () => {
  it.each([
    ['60', 'bullet'],
    ['120+1', 'bullet'],
    ['180+2', 'blitz'],
    ['300', 'blitz'],
    ['600+5', 'rapid'],
    ['900+10', 'rapid'],
    ['1800', 'classical'],
    ['1/86400', 'classical'],
    ['60|d10', 'bullet'],
    ['1 day per move', 'bullet'],
    ['-', null],
    ['', null],
    [null, null],
  ] as const)('%s -> %s', (tc, expected) => {
    expect(timeCategory(tc)).toBe(expected);
  });
});

describe('TABLES vs d1/migrations', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../../d1/migrations');
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');

  /** Column names of `CREATE TABLE name (...)` plus `ALTER TABLE name ADD COLUMN` in the migrations. */
  function columns(table: string): Set<string> {
    const m = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql);
    if (!m) throw new Error(`no CREATE TABLE ${table}`);
    const cols = new Set<string>();
    for (const line of m[1].split('\n')) {
      const c = /^\s{2}([a-zA-Z_]+)\s+(TEXT|INTEGER|REAL)\b/.exec(line);
      if (c) cols.add(c[1]);
    }
    const added = new RegExp(`ALTER TABLE ${table} ADD COLUMN ([a-zA-Z_]+) (?:TEXT|INTEGER|REAL)\\b`, 'g');
    for (const a of sql.matchAll(added)) cols.add(a[1]);
    return cols;
  }

  it('lists the 17 app tables ported from Supabase', () => {
    expect(APP_TABLES).toHaveLength(17);
    for (const t of APP_TABLES) expect(sql).toContain(`CREATE TABLE ${t} (`);
  });

  it('every mapped column exists with the right SQLite type', () => {
    for (const [table, s] of Object.entries(TABLES)) {
      const cols = columns(table);
      for (const c of [...s.bool, ...s.json, ...s.ts]) expect(cols, `${table}.${c}`).toContain(c);
    }
  });

  it('every boolean column carries an IN (0, 1) check', () => {
    for (const [table, s] of Object.entries(TABLES)) {
      for (const c of s.bool) expect(sql, `${table}.${c}`).toContain(`CHECK (${c} IN (0, 1))`);
    }
  });

  it('every JSON column is json_valid-checked', () => {
    for (const [table, s] of Object.entries(TABLES)) {
      for (const c of s.json) expect(sql, `${table}.${c}`).toMatch(new RegExp(`json_valid\\(${c}\\)`));
    }
  });
});
