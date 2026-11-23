// The fixed words: the template scripts (used when Claude's script fails the
// checks in script.ts), the end card, and the caption tail every post gets.
// Voice: direct, warm, chess-literate; "Elo", never "ELO". No emoji.
import { sideLabel, type Puzzle } from './puzzle.ts';
import type { VideoScript } from './script.ts';
import { spokenSan } from './spoken.ts';

/** "2065 blitz", "rapid", or "" when we know neither. */
export function ratingLabel(p: Puzzle): string {
  const tc = p.timeControl && p.timeControl !== 'unknown' ? p.timeControl : '';
  return [p.rating ? String(p.rating) : '', tc].filter(Boolean).join(' ');
}

/** Stable pick from a list by a string (same puzzle → same template). */
function pick<T>(list: readonly T[], key: string): T {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

interface TemplateHook {
  id: string;
  headline: (p: Puzzle) => string;
  hook: (p: Puzzle) => string;
}

export const BLUNDER_HOOKS: readonly TemplateHook[] = [
  {
    id: 'blundered-at',
    headline: (p) => (ratingLabel(p) ? `I blundered this at ${ratingLabel(p)}` : 'I blundered this'),
    hook: (p) => (ratingLabel(p) ? `I blundered this at ${ratingLabel(p)}. Can you find what I missed?` : 'I blundered this in a real game. Can you find what I missed?'),
  },
  {
    id: 'rated-and-missed',
    headline: (p) => (p.rating ? `I'm ${p.rating} and I missed this` : 'I missed this'),
    hook: (p) => (p.rating ? `I'm rated ${p.rating} and I missed this. Don't laugh until you find it.` : `I missed this in a real game. Don't laugh until you find it.`),
  },
  {
    id: 'do-better',
    headline: () => 'I played the wrong move',
    hook: (p) => (ratingLabel(p) ? `${ratingLabel(p)}, and I played the wrong move. Can you do better?` : 'I played the wrong move here. Can you do better?'),
  },
];

export const FALL_HOOKS: readonly TemplateHook[] = [
  {
    id: 'would-you-fall',
    headline: () => 'Would you fall for this?',
    hook: (p) => `${p.fellCount} PatternChess players fell for this. Would you?`,
  },
  {
    id: 'everyone-plays-this',
    headline: () => 'Everyone plays this. It loses.',
    hook: (p) => `${p.fellCount} PatternChess players made the same move here. It loses.`,
  },
];

/** The deterministic fallback script: always passes validateScript. */
export function templateScript(p: Puzzle, countdownSeconds: number): VideoScript {
  const side = sideLabel(p.side);
  const first = p.solution[0];
  const motif = p.motifLabel ? `${p.motifLabel.toLowerCase().replace(/^missed /, 'a ')}` : null;
  const challenge = `${side} to move. You have ${countdownSeconds} seconds.`;
  const reveal = p.mate
    ? `The answer: ${spokenSan(first.san)}. It ends in checkmate.`
    : motif
      ? `The answer: ${spokenSan(first.san)}. ${motif.charAt(0).toUpperCase()}${motif.slice(1)}.`
      : `The answer: ${spokenSan(first.san)}.`;
  if (p.format === 'fall') {
    const h = pick(FALL_HOOKS, p.trapKey ?? p.blunderId);
    const punisher = p.refutation[0];
    return {
      hookStyle: h.id,
      headline: h.headline(p),
      subline: `${side} to move. What do you play?`,
      beats: {
        hook: h.hook(p),
        challenge,
        played: `Most people play ${spokenSan(p.played.san)}. It looks natural.`,
        refutation: `But ${spokenSan(punisher.san)}, and it falls apart.`,
        reveal: `Play ${spokenSan(first.san)} instead.`,
        cta: 'PatternChess finds the traps you keep falling for.',
      },
      captionLead: `${p.fellCount} PatternChess players fell for this. Would you? Comment your move.`,
    };
  }
  const h = pick(BLUNDER_HOOKS, p.blunderId);
  return {
    hookStyle: h.id,
    headline: h.headline(p),
    subline: `${side} to move and win.`,
    beats: {
      hook: h.hook(p),
      challenge,
      played: `I played ${spokenSan(p.played.san)}. Wrong.`,
      reveal,
      cta: 'PatternChess turns your own blunders into puzzles like this.',
    },
    captionLead: `${h.hook(p)} Comment your move before the reveal.`,
  };
}

/** The end card's two lines (fixed, so the brand line never depends on Claude). */
export function endCardLines(p: Puzzle): [string, string] {
  return p.format === 'fall' ? ['Find the traps you fall for', 'patternchess.com'] : ['Train your own blunders', 'patternchess.com'];
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
  const formatTags = p.format === 'fall' ? ['#chesstrap', '#chessopening'] : [];
  const all = [...BASE_TAGS, ...formatTags, ...(p.motif && MOTIF_TAG[p.motif] ? [MOTIF_TAG[p.motif]] : []), ...extra];
  return [...new Set(all)].join(' ');
}

/** "From one of my own blitz games at 2065." (each part only when known). */
function gameLine(p: Puzzle): string {
  const tc = p.timeControl && p.timeControl !== 'unknown' ? `${p.timeControl} ` : '';
  const at = p.rating ? ` at ${p.rating}` : '';
  return `From one of my own ${tc}games${at}.`;
}

function pitch(p: Puzzle): string {
  return p.format === 'fall'
    ? 'PatternChess finds the traps you fall for in your own games and drills them until they stick.'
    : 'PatternChess turns your own blunders into puzzles like this one.';
}

/** Instagram caption (link in bio). */
export function instagramCaption(p: Puzzle, s: VideoScript): string {
  return [
    s.captionLead,
    '',
    `${sideLabel(p.side)} to move. Comment your move before the reveal.`,
    ...(p.format === 'blunder' && !(p.rating && s.captionLead.includes(String(p.rating))) ? [gameLine(p)] : []),
    '',
    `${pitch(p)} Link in bio.`,
    '',
    tags(p, []),
  ].join('\n');
}

/** TikTok caption (Buffer posts it publicly; TikTok bio links need 1k followers, so the domain is spelled out). */
export function tiktokCaption(p: Puzzle, s: VideoScript): string {
  return [
    `${s.captionLead} ${sideLabel(p.side)} to move.`,
    `${pitch(p)} patternchess.com`,
    tags(p, ['#chesstok']),
  ].join('\n');
}
