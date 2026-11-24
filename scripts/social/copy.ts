// The fixed words: the template scripts (used when Claude's script fails the
// checks in script.ts), the end card, and the caption tail every post gets.
// Voice: direct, warm, chess-literate; "Elo", never "ELO". No emoji.
import { sideLabel, type Puzzle } from './puzzle.ts';
import type { Facts, VideoScript } from './script.ts';
import { spokenSan } from './spoken.ts';

/** "2065 blitz", "rapid", or "" when we know neither. */
export function ratingLabel(p: Puzzle): string {
  const tc = p.timeControl && p.timeControl !== 'unknown' ? p.timeControl : '';
  return [p.rating ? String(p.rating) : '', tc].filter(Boolean).join(' ');
}

interface TemplateHook {
  headline: (p: Puzzle, f: TemplateFacts) => string;
  hook: (p: Puzzle, f: TemplateFacts) => string;
}

/** What the templates need beyond the puzzle (from script.ts buildFacts). */
export type TemplateFacts = Pick<Facts, 'angle' | 'solutionWins' | 'pro'>;

const blunderer = (f: TemplateFacts) => f.pro?.blunderer ?? 'The player';
const winner = (f: TemplateFacts) => f.pro?.winner ?? 'The opponent';

/** One fallback hook per angle in hooks.ts (a test checks every angle has one and passes the checks). */
export const TEMPLATE_HOOKS: Record<string, TemplateHook> = {
  'pause-now': {
    headline: () => 'Pause now. Most people miss this',
    hook: () => 'Pause the video now. Most people miss this one.',
  },
  'one-move': {
    headline: () => 'One move. Find it.',
    hook: () => 'One move wins here. Find it before the timer runs out.',
  },
  'engine-laughed': {
    headline: () => 'The engine laughed at this move',
    hook: (p) => (p.format === 'fall' ? 'The engine laughs at the move most people play here.' : 'The engine laughed at the move played here. Can you do better?'),
  },
  'only-move': {
    headline: () => 'Only one move wins here',
    hook: () => 'Only one move wins here. Everything else lets it slip.',
  },
  'looks-quiet': {
    headline: () => "Looks quiet. It isn't.",
    hook: () => "This position looks quiet. It isn't.",
  },
  'comment-first': {
    headline: () => 'Comment your move first',
    hook: () => 'Comment your move before the reveal. No peeking.',
  },
  'rating-check': {
    headline: (p) => `A ${p.rating} player missed this`,
    hook: (p) => `A ${ratingLabel(p)} player missed this in a real game. Can you find it?`,
  },
  'hidden-mate': {
    headline: () => "There's a forced mate here",
    hook: () => "There's a forced mate in this position. Find it.",
  },
  'wins-material': {
    headline: (_p, f) => `One move wins ${f.solutionWins}`,
    hook: (_p, f) => `One move here wins ${f.solutionWins}. Find it.`,
  },
  'natural-move-loses': {
    headline: () => 'The natural move here loses',
    hook: () => 'The natural move here loses on the spot. Would you play it?',
  },
  'would-you-fall': {
    headline: () => 'Would you fall for this?',
    hook: (p) => `${p.fellCount} PatternChess players fell for this. Would you?`,
  },
  'decided-the-game': {
    headline: () => 'One move decided this game',
    hook: (_p, f) => `${blunderer(f)} versus ${winner(f)}. One move decided it.`,
  },
  'find-the-punishment': {
    headline: () => 'Find the punishment',
    hook: (_p, f) => `${blunderer(f)} just blundered. Find the punishment.`,
  },
  'even-grandmasters': {
    headline: () => 'Even grandmasters blunder',
    hook: (_p, f) => `Even ${blunderer(f)} blunders. Can you spot the punishment?`,
  },
  'event-stakes': {
    headline: () => 'One move. Game over.',
    hook: (_p, f) => `${f.pro?.event ?? 'A real game'}. One move, and the game was over.`,
  },
};

/** "GM Hikaru Nakamura (3250) vs GM Magnus Carlsen (3301), Titled Tuesday 2026." */
export function proCredit(p: Puzzle): string {
  if (!p.pro) return '';
  const who = (x: NonNullable<Puzzle['pro']>['white']) => `${x.title ? `${x.title} ` : ''}${x.name}${x.rating ? ` (${x.rating})` : ''}`;
  return `${who(p.pro.white)} vs ${who(p.pro.black)}, ${p.pro.event} ${p.pro.year}.`;
}

/** The deterministic fallback script for the assigned angle: always passes validateScript. */
export function templateScript(p: Puzzle, countdownSeconds: number, f: TemplateFacts): VideoScript {
  const h = TEMPLATE_HOOKS[f.angle.id];
  if (!h) throw new Error(`no template for hook angle ${f.angle.id}`);
  const side = sideLabel(p.side);
  const first = p.solution[0];
  const motif = p.motifLabel ? `${p.motifLabel.toLowerCase().replace(/^missed /, 'a ')}` : null;
  const challenge = `${side} to move. You have ${countdownSeconds} seconds.`;
  const reveal = p.mate
    ? `The answer: ${spokenSan(first.san)}. It ends in checkmate.`
    : motif
      ? `The answer: ${spokenSan(first.san)}. ${motif.charAt(0).toUpperCase()}${motif.slice(1)}.`
      : `The answer: ${spokenSan(first.san)}.`;
  const hook = h.hook(p, f);
  if (p.format === 'pro') {
    const solved = p.mate ? ' It ends in checkmate.' : '';
    const found = f.pro?.foundInGame ? ` ${winner(f)} found it.` : '';
    return {
      hookStyle: f.angle.id,
      headline: h.headline(p, f),
      subline: `${side} to move and win.`,
      beats: {
        hook,
        challenge,
        played: `${blunderer(f)} played ${spokenSan(p.played.san)}. It loses on the spot.`,
        reveal: `The punishment: ${spokenSan(first.san)}.${solved}${found}`,
        cta: 'Blunders decide games. PatternChess finds yours. Fix yours now.',
      },
      captionLead: `${hook} Comment the winning move.`,
      youtubeTitle: `${f.pro ? `${f.pro.blunderer} vs ${f.pro.winner}: ` : ''}find the punishment | ${p.pro?.event ?? 'Chess'}`,
    };
  }
  if (p.format === 'fall') {
    const punisher = p.refutation[0];
    return {
      hookStyle: f.angle.id,
      headline: h.headline(p, f),
      subline: `${side} to move. What do you play?`,
      beats: {
        hook,
        challenge,
        played: `Most people play ${spokenSan(p.played.san)}. It looks natural.`,
        refutation: `But ${spokenSan(punisher.san)}, and it falls apart.`,
        reveal: `Play ${spokenSan(first.san)} instead.`,
        cta: 'PatternChess finds the traps you keep falling for.',
      },
      captionLead: `${hook} Comment your move.`,
      youtubeTitle: `${h.headline(p, f)} | Chess trap`,
    };
  }
  return {
    hookStyle: f.angle.id,
    headline: h.headline(p, f),
    subline: `${side} to move and win.`,
    beats: {
      hook,
      challenge,
      played: `${side} played ${spokenSan(p.played.san)}. It loses.`,
      reveal,
      cta: 'PatternChess turns your own blunders into puzzles like this.',
    },
    captionLead: `${hook} Comment your move before the reveal.`,
    youtubeTitle: `${h.headline(p, f)} | Chess puzzle`,
  };
}

/** The end card's two lines (fixed, so the brand line never depends on Claude). */
export function endCardLines(p: Puzzle): [string, string] {
  if (p.format === 'pro') return ['Blunders decide games', 'Fix yours: patternchess.com'];
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
  const formatTags = p.format === 'fall' ? ['#chesstrap', '#chessopening'] : p.format === 'pro' ? ['#chessblunder', '#grandmaster'] : [];
  const all = [...BASE_TAGS, ...formatTags, ...(p.motif && MOTIF_TAG[p.motif] ? [MOTIF_TAG[p.motif]] : []), ...extra];
  return [...new Set(all)].join(' ');
}

/** "From a real 2065 blitz game." (each part only when known). */
function gameLine(p: Puzzle): string {
  const label = ratingLabel(p);
  return label ? `From a real ${label} game.` : 'From a real game.';
}

function pitch(p: Puzzle): string {
  if (p.format === 'pro') return 'Blunders decide games. PatternChess finds the ones in your own games and drills them until they stick. Fix yours.';
  return p.format === 'fall'
    ? 'PatternChess finds the traps you fall for in your own games and drills them until they stick.'
    : 'PatternChess turns your own blunders into puzzles like this one.';
}

/** Where the position came from (pro: the game credit; blunder: "From a real 2056 blitz game."). */
function sourceLine(p: Puzzle, s: VideoScript): string[] {
  if (p.format === 'pro') return [proCredit(p)];
  if (p.format === 'blunder' && !(p.rating && s.captionLead.includes(String(p.rating)))) return [gameLine(p)];
  return [];
}

/** Instagram caption (link in bio). */
export function instagramCaption(p: Puzzle, s: VideoScript): string {
  return [
    s.captionLead,
    '',
    `${sideLabel(p.side)} to move. Comment your move before the reveal.`,
    ...sourceLine(p, s),
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
    ...(p.format === 'pro' ? [proCredit(p)] : []),
    `${pitch(p)} patternchess.com`,
    tags(p, ['#chesstok']),
  ].join('\n');
}

/** The YouTube Short's title (the script's, else the headline). */
export function youtubeTitle(p: Puzzle, s: VideoScript): string {
  const t = s.youtubeTitle?.trim() || `${s.headline} | ${p.format === 'pro' ? 'Blunders decide games' : 'Chess puzzle'}`;
  return t.slice(0, 100);
}

/** The YouTube Short's description. */
export function youtubeDescription(p: Puzzle, s: VideoScript): string {
  return [
    s.captionLead,
    '',
    `${sideLabel(p.side)} to move. Comment your move before the reveal.`,
    ...sourceLine(p, s),
    '',
    `${pitch(p)} patternchess.com`,
    '',
    tags(p, ['#shorts']),
  ].join('\n');
}
