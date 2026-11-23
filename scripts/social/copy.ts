// The words on the video and in the captions. Hooks rotate (the id is stored
// on the social_posts row) so Reel insights can say which one works; add or
// retire templates here and nowhere else. Voice: direct, warm, chess-literate;
// "Elo", never "ELO". No emoji.
import { sideLabel, type Puzzle } from './puzzle.ts';

export interface Hook {
  id: string;
  /** Big first line on the video. */
  line1: (p: Puzzle) => string;
  /** Gold second line: the challenge. */
  line2: (p: Puzzle) => string;
}

/** "2065 blitz", "rapid", or "" when we know neither. */
export function ratingLabel(p: Puzzle): string {
  const tc = p.timeControl && p.timeControl !== 'unknown' ? p.timeControl : '';
  return [p.rating ? String(p.rating) : '', tc].filter(Boolean).join(' ');
}

export const HOOKS: readonly Hook[] = [
  {
    id: 'blundered-at',
    line1: (p) => (ratingLabel(p) ? `I blundered this at ${ratingLabel(p)}.` : 'I blundered this in a real game.'),
    line2: () => 'Can you find what I missed?',
  },
  {
    id: 'rated-you-should',
    line1: (p) => (p.rating ? `I'm rated ${p.rating} and I missed this.` : 'I missed this in a real game.'),
    line2: (p) => `${sideLabel(p.side)} to move and win.`,
  },
  {
    id: 'what-should-i',
    line1: (p) => (p.timeControl && p.timeControl !== 'unknown' ? `My ${p.timeControl} blunder of the day.` : 'My blunder of the day.'),
    line2: () => 'What should I have played?',
  },
  {
    id: 'do-better',
    line1: (p) => (ratingLabel(p) ? `${ratingLabel(p)}. I played the wrong move.` : 'I played the wrong move here.'),
    line2: () => 'Can you do better?',
  },
];

export function hookById(id: string): Hook {
  return HOOKS.find((h) => h.id === id) ?? HOOKS[0];
}

/** Round-robin by day number so consecutive days never share a hook. */
export function hookForDay(day: string): Hook {
  const n = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400_000);
  return HOOKS[n % HOOKS.length];
}

const BASE_TAGS = ['#chess', '#chesspuzzle', '#chesstactics'];

const MOTIF_TAG: Record<string, string> = {
  missedMate: '#checkmate',
  missedFork: '#chessfork',
  missedSkewer: '#chesstips',
  missedPin: '#chesstips',
  missedDiscoveredAttack: '#chesstips',
  hangingPiece: '#chesstips',
  trappedPiece: '#chesstips',
  backRankWeakness: '#backrank',
};

function tags(p: Puzzle, extra: string[]): string {
  const all = [...BASE_TAGS, ...(p.motif && MOTIF_TAG[p.motif] ? [MOTIF_TAG[p.motif]] : []), ...extra];
  return [...new Set(all)].join(' ');
}

/** "From one of my own blitz games at 2065." (each part only when known). */
function gameLine(p: Puzzle): string {
  const tc = p.timeControl && p.timeControl !== 'unknown' ? `${p.timeControl} ` : '';
  const at = p.rating ? ` at ${p.rating}` : '';
  return `From one of my own ${tc}games${at}.`;
}

/** Instagram caption (link in bio). */
export function instagramCaption(p: Puzzle, hook: Hook): string {
  return [
    `${hook.line1(p)} ${hook.line2(p)}`,
    '',
    `${sideLabel(p.side)} to move. Comment your move before the reveal.`,
    ...(p.rating && hook.line1(p).includes(String(p.rating)) ? [] : [gameLine(p)]),
    '',
    'PatternChess turns your own blunders into puzzles like this one. Link in bio.',
    '',
    tags(p, []),
  ].join('\n');
}

/** TikTok caption (typed in the app after the inbox draft lands; bio links need 1k followers). */
export function tiktokCaption(p: Puzzle, hook: Hook): string {
  return [
    `${hook.line1(p)} ${hook.line2(p)} ${sideLabel(p.side)} to move. Comment your move before the reveal.`,
    'Turn your own blunders into puzzles: patternchess.com',
    tags(p, ['#chesstok']),
  ].join('\n');
}
