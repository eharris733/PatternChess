/**
 * Pixel avatars: a 16×16 blocky portrait built from a handful of parts. Pure
 * data + functions (no DOM), shared by the SVG component
 * (src/components/avatar/PixelAvatar.tsx), the share-card canvas and the
 * server (profile.update validates with `sanitizeAvatar`; leaderboard.get
 * fills `defaultAvatar(id)` for players who never built one).
 *
 * Stored as JSON in `profiles.avatar` (migration 0005); NULL means "the
 * default one", generated deterministically from the player's id so it never
 * changes between screens. Some accessories are rewards (src/lib/rewards.ts);
 * unlocks are client-checked, like flair, because they are cosmetic.
 */

export interface AvatarParts {
  background: string;
  skin: string;
  hair: string;
  hairColor: string;
  eyes: string;
  mouth: string;
  outfit: string;
  outfitColor: string;
  accessory: string;
}

export type AvatarPart = keyof AvatarParts;

export interface AvatarOption {
  id: string;
  label: string;
  /** Swatch colour for colour parts. */
  color?: string;
}

const opt = (id: string, label: string, color?: string): AvatarOption => ({ id, label, color });

export const AVATAR_OPTIONS: Record<AvatarPart, readonly AvatarOption[]> = {
  background: [
    opt('gold', 'Gold', '#E4C36A'),
    opt('sky', 'Sky', '#9CC9EA'),
    opt('mint', 'Mint', '#A8DDB5'),
    opt('rose', 'Rose', '#F0AFC0'),
    opt('lilac', 'Lilac', '#C7B4E8'),
    opt('sand', 'Sand', '#E9D8B4'),
    opt('slate', 'Slate', '#8C9AA8'),
    opt('night', 'Night', '#2E3550'),
  ],
  skin: [
    opt('s1', 'Light', '#F8D9C0'),
    opt('s2', 'Fair', '#EEC19E'),
    opt('s3', 'Medium', '#D9A27A'),
    opt('s4', 'Tan', '#B97D55'),
    opt('s5', 'Brown', '#8D5A3B'),
    opt('s6', 'Deep', '#5E3B27'),
  ],
  hair: [
    opt('short', 'Short'),
    opt('spiky', 'Spiky'),
    opt('long', 'Long'),
    opt('bob', 'Bob'),
    opt('curly', 'Curly'),
    opt('mohawk', 'Mohawk'),
    opt('bun', 'Bun'),
    opt('none', 'None'),
  ],
  hairColor: [
    opt('black', 'Black', '#1F1A17'),
    opt('brown', 'Brown', '#5B3A22'),
    opt('auburn', 'Auburn', '#8E3B1E'),
    opt('blond', 'Blond', '#E2B84F'),
    opt('grey', 'Grey', '#A9A9A4'),
    opt('white', 'White', '#F2F0EA'),
    opt('blue', 'Blue', '#3A6FD0'),
    opt('pink', 'Pink', '#E070A8'),
  ],
  eyes: [opt('dots', 'Dots'), opt('wide', 'Wide'), opt('sleepy', 'Sleepy'), opt('wink', 'Wink')],
  mouth: [opt('smile', 'Smile'), opt('grin', 'Grin'), opt('flat', 'Flat'), opt('open', 'Surprised')],
  outfit: [opt('tee', 'T-shirt'), opt('hoodie', 'Hoodie'), opt('collar', 'Collar'), opt('suit', 'Suit')],
  outfitColor: [
    opt('gold', 'Gold', '#C49B2A'),
    opt('red', 'Red', '#C44536'),
    opt('blue', 'Blue', '#2F5D9E'),
    opt('green', 'Green', '#3E8E52'),
    opt('purple', 'Purple', '#7A4FB0'),
    opt('teal', 'Teal', '#2A8C8C'),
    opt('charcoal', 'Charcoal', '#3A3A38'),
    opt('cream', 'Cream', '#EFE6CF'),
  ],
  accessory: [
    opt('none', 'None'),
    opt('glasses', 'Glasses'),
    opt('cap', 'Cap'),
    opt('headband', 'Headband'),
    opt('beanie', 'Beanie'),
    opt('shades', 'Shades'),
    opt('eyepatch', 'Eyepatch'),
    opt('crown', 'Crown'),
  ],
};

export const AVATAR_PART_LABEL: Record<AvatarPart, string> = {
  background: 'Background',
  skin: 'Skin',
  hair: 'Hair',
  hairColor: 'Hair colour',
  eyes: 'Eyes',
  mouth: 'Mouth',
  outfit: 'Outfit',
  outfitColor: 'Outfit colour',
  accessory: 'Extra',
};

export const AVATAR_PARTS: readonly AvatarPart[] = [
  'skin',
  'hair',
  'hairColor',
  'eyes',
  'mouth',
  'accessory',
  'outfit',
  'outfitColor',
  'background',
];

/** Accessories every default (generated) avatar may get; rewards are never handed out at random. */
const DEFAULT_ACCESSORIES = ['none', 'none', 'none', 'glasses', 'cap', 'headband'];

/** FNV-1a 32-bit: a stable, cheap hash for seeding the default avatar. */
function hash(seed: string, salt: number): number {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The generated avatar for a player who hasn't built one (same seed → same face everywhere). */
export function defaultAvatar(seed: string): AvatarParts {
  const pick = (part: AvatarPart, i: number, pool?: readonly string[]) => {
    const ids = pool ?? AVATAR_OPTIONS[part].map((o) => o.id);
    return ids[hash(seed || 'player', i) % ids.length];
  };
  return {
    background: pick('background', 1),
    skin: pick('skin', 2),
    hair: pick('hair', 3, ['short', 'spiky', 'long', 'bob', 'curly', 'bun']),
    hairColor: pick('hairColor', 4, ['black', 'brown', 'auburn', 'blond', 'grey']),
    eyes: pick('eyes', 5, ['dots', 'wide', 'sleepy']),
    mouth: pick('mouth', 6, ['smile', 'grin', 'flat']),
    outfit: pick('outfit', 7),
    outfitColor: pick('outfitColor', 8),
    accessory: pick('accessory', 9, DEFAULT_ACCESSORIES),
  };
}

function isOption(part: AvatarPart, v: unknown): v is string {
  return typeof v === 'string' && AVATAR_OPTIONS[part].some((o) => o.id === v);
}

/**
 * A complete, valid avatar from untrusted JSON, or null when it isn't one
 * (unknown part ids, missing parts, extra keys). Used by the server allowlist
 * and the client mapper alike.
 */
export function sanitizeAvatar(v: unknown): AvatarParts | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some((k) => !(AVATAR_PARTS as readonly string[]).includes(k))) return null;
  const out = {} as AvatarParts;
  for (const part of AVATAR_PARTS) {
    if (!isOption(part, o[part])) return null;
    out[part] = o[part] as string;
  }
  return out;
}

/** The avatar to show: the stored one, or the generated default for `seed` (the player's id). */
export function resolveAvatar(stored: unknown, seed: string): AvatarParts {
  return sanitizeAvatar(stored) ?? defaultAvatar(seed);
}

function color(part: AvatarPart, id: string): string {
  return AVATAR_OPTIONS[part].find((o) => o.id === id)?.color ?? '#888888';
}

const INK = '#1A1A1A';
const WHITE = '#FFFFFF';

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * (1 + amount))));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

export const AVATAR_GRID = 16;

/** One horizontal run of same-coloured pixels. */
export interface PixelRun {
  x: number;
  y: number;
  w: number;
  color: string;
}

/**
 * Paints the avatar onto a 16×16 grid and returns it as horizontal runs (one
 * SVG rect or canvas fillRect each). Layer order: background, body, neck,
 * head, face, hair, accessory.
 */
export function avatarPixels(parts: AvatarParts): PixelRun[] {
  const grid: string[][] = Array.from({ length: AVATAR_GRID }, () => Array<string>(AVATAR_GRID).fill(''));
  const px = (x: number, y: number, c: string) => {
    if (x >= 0 && x < AVATAR_GRID && y >= 0 && y < AVATAR_GRID) grid[y][x] = c;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(x, y, c);
  };

  const bg = color('background', parts.background);
  const skin = color('skin', parts.skin);
  const skinShade = shade(skin, -0.18);
  const hair = color('hairColor', parts.hairColor);
  const cloth = color('outfitColor', parts.outfitColor);
  const clothShade = shade(cloth, -0.25);

  rect(0, 0, 15, 15, bg);

  // Body + outfit (rows 12–15).
  switch (parts.outfit) {
    case 'hoodie':
      rect(2, 12, 13, 15, cloth);
      rect(4, 11, 5, 11, clothShade);
      rect(10, 11, 11, 11, clothShade);
      px(6, 13, WHITE);
      px(9, 13, WHITE);
      px(6, 14, WHITE);
      px(9, 14, WHITE);
      break;
    case 'collar':
      rect(3, 12, 12, 15, cloth);
      rect(6, 12, 9, 12, skin);
      px(5, 12, WHITE);
      px(6, 13, WHITE);
      px(10, 12, WHITE);
      px(9, 13, WHITE);
      break;
    case 'suit':
      rect(3, 12, 12, 15, '#2B2B33');
      rect(7, 12, 8, 15, WHITE);
      rect(7, 13, 8, 14, cloth);
      px(6, 12, '#3C3C46');
      px(9, 12, '#3C3C46');
      break;
    default: // tee
      rect(3, 12, 12, 15, cloth);
      rect(6, 12, 9, 12, skin);
      px(3, 15, clothShade);
      px(12, 15, clothShade);
  }

  // Neck + head (face 4..11 × 3..10) + ears.
  rect(6, 11, 9, 11, skinShade);
  rect(4, 3, 11, 10, skin);
  px(3, 6, skin);
  px(3, 7, skinShade);
  px(12, 6, skin);
  px(12, 7, skinShade);

  // Eyes (row 6) and mouth (rows 8–9).
  switch (parts.eyes) {
    case 'wide':
      // Raised brows + whites beside the pupils, so it reads on light skin too.
      rect(5, 4, 6, 4, INK);
      rect(9, 4, 10, 4, INK);
      rect(5, 5, 5, 6, WHITE);
      rect(10, 5, 10, 6, WHITE);
      rect(6, 5, 6, 6, INK);
      rect(9, 5, 9, 6, INK);
      break;
    case 'sleepy':
      rect(5, 6, 6, 6, INK);
      rect(9, 6, 10, 6, INK);
      break;
    case 'wink':
      rect(6, 5, 6, 6, INK);
      rect(9, 6, 10, 6, INK);
      break;
    default: // dots
      rect(6, 5, 6, 6, INK);
      rect(9, 5, 9, 6, INK);
  }
  switch (parts.mouth) {
    case 'grin':
      rect(6, 8, 9, 8, INK);
      rect(7, 9, 8, 9, WHITE);
      px(6, 9, INK);
      px(9, 9, INK);
      break;
    case 'flat':
      rect(7, 9, 8, 9, INK);
      break;
    case 'open':
      rect(7, 8, 8, 9, INK);
      break;
    default: // smile
      px(6, 8, INK);
      px(9, 8, INK);
      rect(7, 9, 8, 9, INK);
  }

  // Hair.
  switch (parts.hair) {
    case 'short':
      rect(4, 2, 11, 3, hair);
      px(4, 4, hair);
      px(11, 4, hair);
      break;
    case 'spiky':
      for (const x of [4, 6, 8, 10]) px(x, 1, hair);
      rect(4, 2, 11, 3, hair);
      px(4, 4, hair);
      px(11, 4, hair);
      break;
    case 'long':
      rect(4, 2, 11, 3, hair);
      rect(3, 3, 3, 11, hair);
      rect(12, 3, 12, 11, hair);
      px(4, 4, hair);
      px(11, 4, hair);
      break;
    case 'bob':
      rect(4, 2, 11, 3, hair);
      rect(3, 3, 4, 8, hair);
      rect(11, 3, 12, 8, hair);
      break;
    case 'curly':
      rect(4, 1, 11, 3, hair);
      for (const x of [3, 5, 7, 9, 11]) px(x + 1, 0, hair);
      rect(3, 2, 3, 6, hair);
      rect(12, 2, 12, 6, hair);
      px(5, 3, shade(hair, 0.25));
      px(9, 2, shade(hair, 0.25));
      break;
    case 'mohawk':
      rect(7, 0, 8, 3, hair);
      break;
    case 'bun':
      rect(7, 0, 8, 1, hair);
      rect(4, 2, 11, 3, hair);
      px(4, 4, hair);
      px(11, 4, hair);
      break;
    default: // none
      break;
  }

  // Accessory on top.
  switch (parts.accessory) {
    case 'glasses':
      rect(5, 5, 7, 5, INK);
      rect(8, 5, 10, 5, INK);
      px(5, 6, INK);
      px(7, 6, INK);
      px(8, 6, INK);
      px(10, 6, INK);
      break;
    case 'shades':
      rect(4, 5, 11, 6, INK);
      px(5, 5, '#4A4A55');
      px(9, 5, '#4A4A55');
      break;
    case 'cap':
      rect(4, 1, 11, 3, cloth);
      rect(1, 3, 6, 3, clothShade);
      px(8, 1, WHITE);
      break;
    case 'headband':
      rect(4, 3, 11, 3, '#C44536');
      px(12, 4, '#C44536');
      px(13, 5, '#C44536');
      break;
    case 'beanie':
      rect(7, 0, 8, 0, WHITE);
      rect(4, 1, 11, 2, '#2F5D9E');
      rect(4, 3, 11, 3, '#5B83C2');
      break;
    case 'eyepatch':
      rect(4, 4, 11, 4, INK);
      rect(8, 5, 10, 6, INK);
      break;
    case 'crown':
      px(4, 0, '#E4B842');
      rect(7, 0, 8, 0, '#E4B842');
      px(11, 0, '#E4B842');
      rect(4, 1, 11, 2, '#E4B842');
      px(6, 2, '#C44536');
      px(9, 2, '#2F5D9E');
      break;
    default:
      break;
  }

  const runs: PixelRun[] = [];
  for (let y = 0; y < AVATAR_GRID; y++) {
    let x = 0;
    while (x < AVATAR_GRID) {
      const c = grid[y][x];
      let w = 1;
      while (x + w < AVATAR_GRID && grid[y][x + w] === c) w++;
      if (c) runs.push({ x, y, w, color: c });
      x += w;
    }
  }
  return runs;
}

/** Draws the avatar onto a canvas at (x, y) with edge `size` (share cards). */
export function drawAvatar(
  ctx: { fillStyle: unknown; fillRect(x: number, y: number, w: number, h: number): void },
  parts: AvatarParts,
  x: number,
  y: number,
  size: number,
): void {
  const unit = size / AVATAR_GRID;
  for (const r of avatarPixels(parts)) {
    ctx.fillStyle = r.color;
    // +0.5 px overlap hides seams between runs when scaled.
    ctx.fillRect(x + r.x * unit, y + r.y * unit, r.w * unit + 0.5, unit + 0.5);
  }
}
