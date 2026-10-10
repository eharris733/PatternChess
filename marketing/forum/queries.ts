// What makes a thread worth a reply: the problems PatternChess actually solves.
// Weights are rough: 3 = squarely about the method, 1 = adjacent.

export const KEYWORDS: { pattern: RegExp; weight: number; topic: string }[] = [
  { pattern: /woodpecker/i, weight: 3, topic: 'woodpecker method' },
  { pattern: /spaced repetition|anki/i, weight: 3, topic: 'spaced repetition' },
  { pattern: /(same|repeat\w*|keep making).{0,20}(mistake|blunder)/i, weight: 3, topic: 'repeating mistakes' },
  { pattern: /(review|analy[sz]e|learn from).{0,25}(my |own )?(games|blunders|mistakes)/i, weight: 3, topic: 'reviewing own games' },
  { pattern: /stop blunder|blunder(ing)? (too much|a lot|every game)|how (do i|to) (stop|avoid) blunder/i, weight: 2, topic: 'blundering' },
  { pattern: /(won|winning|drawn) endgame|convert(ing)? (a )?(win|advantage)|throw(ing)? (away )?(won|winning)/i, weight: 2, topic: 'converting endgames' },
  { pattern: /opening (repertoire|prep)|out of (book|theory)|forget (my )?(opening|theory)/i, weight: 2, topic: 'opening prep' },
  // Chess.com's own post-game feature; confusion about it = wants better post-game learning.
  { pattern: /game review|review (says|said|shows|showed)|why (is|isn'?t) (this|it|that) (a )?(brilliant|great move)|best moves?.{0,25}(doesn'?t|didn'?t|not) show/i, weight: 3, topic: 'game review confusion' },
  { pattern: /memori[sz]e?d?.{0,30}(moves|openings?|lines|theory)|why (did )?i lost|why is (this|that) a (blunder|mistake)|the game i lost|hung my (queen|rook|pieces?)|i keep losing|keep losing (games|to)/i, weight: 2, topic: 'understanding own losses' },
  { pattern: /(reach|get to|break(ing)?|hit) \d{3,4}\b|\d{3,4} (elo|rating) goal/i, weight: 2, topic: 'rating goal' },
  { pattern: /blitz.{0,30}(ruin|hurt|bad for)|(play|playing) too (much|many) (blitz|bullet)/i, weight: 1, topic: 'training habits' },
  { pattern: /how (do i|to|can i) improve|stuck at \d{3,4}|plateau|chess improvement|ways? to improve/i, weight: 1, topic: 'improvement plateau' },
  { pattern: /tactics? (training|puzzles?)|puzzle rush|puzzles? (don't|not) help/i, weight: 1, topic: 'tactics training' },
];

// Threads already mentioning us get skipped (no piling on).
export const OWN_MENTION = /patternchess/i;

// Titles that are never a fit, whatever keywords they contain: social, trivia,
// rules/how-to basics and site-support questions.
export const NOISE = new RegExp(
  [
    'join my club|club invite|meme|funny|giveaway|cheat(er|ing)|ban(ned)?\\b|rate my (pfp|avatar)',
    'beta testers?|check out my|i (made|built|created) (a|an)\\b|special offer|\\$\\s?\\d|ebook|coaching (offer|available)',
    'favou?rite|who is your|song|youtuber|geometry dash',
    'how to castle|en passant|make arrows|how (to|do i) (checkmate|mate) with|mate with (king|two|2)',
    'browser|send games? to|set ?up (a )?match|ai vs ai|\\bbot\\b|badges?|which is better chess',
  ].join('|'),
  'i',
);

// First posts that are someone else's product pitch — replying there helps them, not us.
export const PROMO = /\b(i|we) (just )?(built|made|created|developed|launched)\b|\bmy (app|site|website|tool|extension|platform|course|ebook|book)\b|it'?s called\b|sign up|free trial|beta test|special offer|discount|coupon|\$\s?\d|\bebook\b|(send|dm|message) me|reach out to me|i (will|can|'ll) (coach|teach|play a few games with)/i;

// ---- Competitor complaints (their own section in the output) ----

// Named products people move away from. Add names here as they come up.
export const COMPETITORS: { name: string; pattern: RegExp }[] = [
  { name: 'Duolingo chess', pattern: /duolingo/i },
  { name: 'ChessSigma', pattern: /chess ?sigma|chesssigma/i },
  { name: 'ChessReps', pattern: /chess ?reps\b/i },
];

// Generic AI-built chess products, named or not.
export const SLOP = /vibe[- ]?cod(ed|ing)|ai[- ]slop|\bslop\b|ai[- ](generated|made) (app|site|course|tool|trainer)|(made|built|written) (with|by) (ai|chatgpt|claude|cursor)/i;

// Complaint tone: a thread mentioning a competitor only counts when it's unhappy.
export const COMPLAINT = /terrible|awful|garbage|trash|useless|scam|waste of|disappoint|worse|hate|annoying|broken|buggy|refund|not worth|overpriced|paywall|subscription|cancel(l?ed)?|frustrat|doesn'?t (work|teach|help)|stopped using|quit using|alternative|instead of|better than/i;

export function competitorMention(text: string): string | null {
  for (const c of COMPETITORS) if (c.pattern.test(text)) return c.name;
  return SLOP.test(text) ? 'AI-built chess app' : null;
}
