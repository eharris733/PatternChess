// The hook angles: the one place they live. Every video is assigned an angle
// (the least recently used one that fits its facts), Claude writes the hook in
// that angle, and the fallback template has one version per angle — so a week
// of videos never opens the same way twice, and insights can compare angles
// (the id is stored as social_posts.hook_template).
//
// The narrator is an AI voice for PatternChess: never first person.
import type { Format } from './puzzle.ts';

/** What an angle may depend on (a subset of script.ts Facts). */
export interface AngleFacts {
  format: Format;
  rating: number | null;
  endsInMate: boolean;
  solutionWins: string | null;
  fellCount: number | null;
}

export interface HookAngle {
  id: string;
  formats: readonly Format[];
  /** Only offered when the facts support it. */
  needs?: (f: AngleFacts) => boolean;
  /** What the angle is, for Claude. */
  brief: string;
  /** One example line (Claude adapts it, never copies it). */
  example: string;
}

const BIG_PIECES = new Set(['the queen', 'the rook', 'the knight', 'the bishop']);

export const HOOK_ANGLES: readonly HookAngle[] = [
  {
    id: 'pause-now',
    formats: ['blunder', 'fall'],
    brief: 'Tell the viewer to pause right now, because most people get this wrong.',
    example: 'Pause now. Most people miss this.',
  },
  {
    id: 'one-move',
    formats: ['blunder'],
    brief: 'Minimal dare: there is one move, find it.',
    example: 'One move. Find it.',
  },
  {
    id: 'engine-laughed',
    formats: ['blunder', 'fall'],
    brief: 'The engine found the move that was played here laughable. Playful, aimed at the move, never at a person.',
    example: 'The engine laughed at this move.',
  },
  {
    id: 'only-move',
    formats: ['blunder'],
    brief: 'Exactly one move wins; everything else lets the win slip.',
    example: 'Only one move wins here.',
  },
  {
    id: 'looks-quiet',
    formats: ['blunder', 'fall'],
    brief: 'The position looks calm and harmless, and it is not.',
    example: "Looks quiet. It isn't.",
  },
  {
    id: 'comment-first',
    formats: ['blunder', 'fall'],
    brief: 'Ask for the viewer’s move in the comments before the reveal.',
    example: 'Comment your move before the reveal.',
  },
  {
    id: 'rating-check',
    formats: ['blunder'],
    needs: (f) => f.rating != null,
    brief: 'A player at this rating missed it in a real game. Can the viewer do better? (third person: "a 2056 player")',
    example: 'A 2056 player missed this. Can you?',
  },
  {
    id: 'hidden-mate',
    formats: ['blunder'],
    needs: (f) => f.endsInMate,
    brief: 'There is a forced checkmate hiding in the position.',
    example: "There's a forced mate here. Find it.",
  },
  {
    id: 'wins-material',
    formats: ['blunder'],
    needs: (f) => !f.endsInMate && f.solutionWins != null && BIG_PIECES.has(f.solutionWins),
    brief: 'One move wins a big piece (say which piece, never which move).',
    example: 'One move wins the queen.',
  },
  {
    id: 'natural-move-loses',
    formats: ['fall'],
    brief: 'The move that looks most natural here loses on the spot.',
    example: 'The natural move here loses.',
  },
  {
    id: 'would-you-fall',
    formats: ['fall'],
    needs: (f) => f.fellCount != null,
    brief: 'Several PatternChess players fell for this exact trap. Would the viewer?',
    example: '11 PatternChess players fell for this. Would you?',
  },
];

export function angleById(id: string): HookAngle | undefined {
  return HOOK_ANGLES.find((a) => a.id === id);
}

export function eligibleAngles(f: AngleFacts): HookAngle[] {
  return HOOK_ANGLES.filter((a) => a.formats.includes(f.format) && (a.needs?.(f) ?? true));
}

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/**
 * The angle for the next video: the eligible one used least recently in
 * `recentIds` (newest first; never used beats everything), ties broken by a
 * stable hash of `key` so the same puzzle gets the same angle.
 */
export function pickAngle(f: AngleFacts, recentIds: readonly string[], key: string): HookAngle {
  const eligible = eligibleAngles(f);
  if (!eligible.length) throw new Error(`no hook angle fits a ${f.format} video`);
  const lastUse = (id: string) => {
    const i = recentIds.indexOf(id);
    return i < 0 ? Infinity : i;
  };
  const best = Math.max(...eligible.map((a) => lastUse(a.id)));
  const tied = eligible.filter((a) => lastUse(a.id) === best);
  return tied[hash(key) % tied.length];
}

/** A hook already in the queue (newest first), so the next one reads differently. */
export interface RecentHook {
  hookStyle: string;
  headline: string;
  hook: string;
}

/** "Pause now. Most people…" → "pause now most" (compares how two lines open). */
export function openingWords(text: string, n = 3): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, n)
    .join(' ');
}
