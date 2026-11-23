import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AVATAR_GRID,
  AVATAR_OPTIONS,
  AVATAR_PARTS,
  avatarPixels,
  defaultAvatar,
  resolveAvatar,
  sanitizeAvatar,
} from './avatar';
import { PIECE_KEYS, PIECE_SETS, PIECE_SET_INFO } from './pieceSets';
import { BOARD_THEMES, LEGACY_BOARD_THEMES } from './themeIds';
import {
  FREEZE_RUNGS,
  REWARDS,
  itemAvailable,
  rewardTitle,
  rewardUnlocked,
  rewardsForRung,
  unlockHint,
  type RewardState,
} from './rewards';
import { PATH_RUNGS } from './progression';
import { ACHIEVEMENTS } from './achievements';
import { THEME_SWATCHES } from '../components/ThemePicker';

const ROOT = join(__dirname, '..', '..');

describe('avatar', () => {
  it('generates a stable, valid default per seed', () => {
    const a = defaultAvatar('user-1');
    expect(defaultAvatar('user-1')).toEqual(a);
    expect(sanitizeAvatar(a)).toEqual(a);
    const seeds = new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(defaultAvatar(`u${i}`))));
    expect(seeds.size).toBeGreaterThan(30);
  });

  it('never hands out reward items in a default avatar', () => {
    const gated = new Set(REWARDS.flatMap((r) => (r.item.kind === 'avatar' ? [`${r.item.part}:${r.item.id}`] : [])));
    for (let i = 0; i < 300; i++) {
      const a = defaultAvatar(`seed-${i}`);
      for (const part of AVATAR_PARTS) expect(gated.has(`${part}:${a[part]}`), `${part}:${a[part]}`).toBe(false);
    }
  });

  it('rejects unknown ids, missing parts and extra keys', () => {
    const a = defaultAvatar('x');
    expect(sanitizeAvatar({ ...a, hair: 'galaxy' })).toBeNull();
    expect(sanitizeAvatar({ ...a, extra: 1 })).toBeNull();
    const { hair: _hair, ...missing } = a;
    expect(sanitizeAvatar(missing)).toBeNull();
    expect(sanitizeAvatar(null)).toBeNull();
    expect(sanitizeAvatar('x')).toBeNull();
    expect(resolveAvatar({ nope: 1 }, 'x')).toEqual(a);
  });

  it('paints every option inside the 16x16 grid with no gaps', () => {
    for (const part of AVATAR_PARTS) {
      for (const o of AVATAR_OPTIONS[part]) {
        const runs = avatarPixels({ ...defaultAvatar('p'), [part]: o.id });
        const covered = runs.reduce((n, r) => n + r.w, 0);
        expect(covered).toBe(AVATAR_GRID * AVATAR_GRID); // background fills every cell
        for (const r of runs) {
          expect(r.x + r.w).toBeLessThanOrEqual(AVATAR_GRID);
          expect(r.color).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    }
  });
});

describe('piece sets', () => {
  it('bundles all 12 pieces of every non-default set, with a licence entry', () => {
    const licences = readFileSync(join(ROOT, 'public/pieces/LICENSES.md'), 'utf8');
    for (const set of PIECE_SETS) {
      expect(licences, set).toContain(`\`${set}\``);
      expect(PIECE_SET_INFO[set].licence).not.toMatch(/AGPL|NC|unknown/i);
      if (set === 'cburnett') continue;
      for (const k of PIECE_KEYS) expect(existsSync(join(ROOT, 'public/pieces', set, `${k}.svg`)), `${set}/${k}`).toBe(true);
    }
  });

  it('has a CSS rule for every bundled piece', () => {
    const css = readFileSync(join(ROOT, 'src/styles/pieceSets.css'), 'utf8');
    for (const set of PIECE_SETS.filter((s) => s !== 'cburnett')) {
      expect(css.match(new RegExp(`data-piece-set='${set}'`, 'g'))?.length).toBe(12);
    }
  });
});

describe('themes', () => {
  it('has a palette in themes.css and a swatch for every theme', () => {
    const css = readFileSync(join(ROOT, 'src/styles/themes.css'), 'utf8');
    for (const t of BOARD_THEMES) {
      expect(css, t).toContain(`[data-theme='${t}']`);
      expect(THEME_SWATCHES[t], t).toBeDefined();
    }
    expect(LEGACY_BOARD_THEMES).toEqual(['default', 'inverse', 'frozen', 'green', 'purple']);
  });
});

describe('rewards', () => {
  const state = (over: Partial<RewardState> = {}): RewardState => ({
    trained: 0,
    achievements: new Set(),
    isSupporter: false,
    ...over,
  });

  it('only references real rungs, achievements and items, with unique ids', () => {
    const ids = new Set<string>();
    for (const r of REWARDS) {
      expect(ids.has(r.id), r.id).toBe(false);
      ids.add(r.id);
      if ('rung' in r.unlock) expect(PATH_RUNGS).toContain(r.unlock.rung);
      else expect(ACHIEVEMENTS.map((a) => a.id)).toContain(r.unlock.achievement);
      if (r.item.kind === 'theme') expect(BOARD_THEMES).toContain(r.item.id);
      if (r.item.kind === 'pieceSet') expect(PIECE_SETS).toContain(r.item.id);
      if (r.item.kind === 'avatar') expect(AVATAR_OPTIONS[r.item.part].map((o) => o.id)).toContain(r.item.id);
    }
  });

  it('keeps the original five themes and the classic pieces free', () => {
    for (const t of LEGACY_BOARD_THEMES) expect(itemAvailable({ kind: 'theme', id: t }, state())).toBe(true);
    expect(itemAvailable({ kind: 'pieceSet', id: 'cburnett' }, state())).toBe(true);
    expect(itemAvailable({ kind: 'avatar', part: 'hair', id: 'short' }, state())).toBe(true);
  });

  it('unlocks by rung, by achievement, and everything (but freezes) for supporters', () => {
    const walnut = { kind: 'theme', id: 'walnut' } as const;
    expect(itemAvailable(walnut, state({ trained: 9 }))).toBe(false);
    expect(itemAvailable(walnut, state({ trained: 10 }))).toBe(true);
    const rose = { kind: 'theme', id: 'rose' } as const;
    expect(itemAvailable(rose, state({ trained: 5000 }))).toBe(false);
    expect(itemAvailable(rose, state({ achievements: new Set(['streak-30']) }))).toBe(true);
    for (const r of REWARDS) {
      expect(rewardUnlocked(r, state({ isSupporter: true }))).toBe(r.item.kind !== 'streakFreeze');
    }
  });

  it('explains what unlocks a locked item', () => {
    expect(unlockHint({ kind: 'pieceSet', id: 'chessnut' }, () => null)).toBe('Unlocks at 25 positions trained');
    expect(unlockHint({ kind: 'theme', id: 'rose' }, (id) => (id === 'streak-30' ? 'Unstoppable' : null))).toBe(
      'Unlocks with the Unstoppable achievement',
    );
    expect(unlockHint({ kind: 'theme', id: 'default' }, () => null)).toBeNull();
  });

  it('banks freezes at 50, 200 and 500, and every rung has a reward', () => {
    expect(FREEZE_RUNGS).toEqual([50, 200, 500]);
    for (const at of PATH_RUNGS) expect(rewardsForRung(at).length, `rung ${at}`).toBeGreaterThan(0);
    expect(rewardTitle({ kind: 'theme', id: 'walnut' })).toBe('Walnut theme');
    expect(rewardTitle({ kind: 'pieceSet', id: 'chessnut' })).toBe('Chessnut pieces');
    expect(rewardTitle({ kind: 'avatar', part: 'accessory', id: 'crown' })).toBe('Crown for your avatar');
  });
});
