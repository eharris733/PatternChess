// The voiceover script for one video: Claude writes it from a fact sheet, the
// guardrails here check every square and number against the facts, and the
// template in copy.ts takes over when Claude fails twice.
//
// Claude runs through the Claude Code CLI (`claude -p`) on the owner's
// subscription, never the paid API: locally the CLI's own login, in GitHub
// Actions CLAUDE_CODE_OAUTH_TOKEN (made once with `claude setup-token`).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { templateScript } from './copy.ts';
import { env } from './env.ts';
import { sideLabel, type Ply, type Puzzle } from './puzzle.ts';
import { spokenSan } from './spoken.ts';

export const BEATS = ['hook', 'challenge', 'played', 'refutation', 'reveal', 'cta'] as const;
export type BeatId = (typeof BEATS)[number];

export interface VideoScript {
  /** Short kebab-case id of the hook angle, stored as social_posts.hook_template. */
  hookStyle: string;
  /** Big first line on screen (mono, upper-cased by the renderer). */
  headline: string;
  /** Gold second line: the challenge. */
  subline: string;
  /** What the narrator says in each scene; `refutation` only in the fall format. */
  beats: Partial<Record<BeatId, string>>;
  /** First lines of the Instagram / TikTok captions (the fixed CTA and tags are appended). */
  captionLead: string;
}

export type ScriptSource = 'claude' | 'template';

const PIECE_NAME: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

interface MoveFact {
  san: string;
  spoken: string;
  by: 'viewer' | 'opponent';
  captures: string | null;
}

export interface Facts {
  format: Puzzle['format'];
  /** The side the viewer plays ("White"). */
  sideToMove: string;
  rating: number | null;
  timeControl: string | null;
  /** fall: how many different PatternChess players played the tempting move here. */
  fellCount: number | null;
  /** blunder: the move I played. fall: the move most people play. */
  played: MoveFact;
  /** fall: how the opponent punishes it. */
  refutation: MoveFact[];
  /** The right move and its line. */
  solution: MoveFact[];
  motif: string | null;
  endsInMate: boolean;
  /** What the punishment / the right move wins, in plain words ("the queen"). */
  refutationWins: string | null;
  solutionWins: string | null;
  countdownSeconds: number;
  /** Every square the script may name. */
  allowedSquares: string[];
  /** Every number the script may say. */
  allowedNumbers: number[];
}

const VALUE: Record<string, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 100 };

function moveFacts(plies: readonly Ply[], firstBy: MoveFact['by']): MoveFact[] {
  return plies.map((p, i) => ({
    san: p.san,
    spoken: spokenSan(p.san),
    by: (i % 2 === 0) === (firstBy === 'viewer') ? 'viewer' : 'opponent',
    captures: p.captured ? PIECE_NAME[p.captured] : null,
  }));
}

/** The biggest piece `by` takes in `moves`, as "the queen" (null when nothing is won). */
function biggestCapture(moves: readonly MoveFact[], by: MoveFact['by']): string | null {
  const caps = moves.filter((m) => m.by === by && m.captures).map((m) => m.captures!);
  if (!caps.length) return null;
  const top = caps.sort((a, b) => VALUE[b] - VALUE[a])[0];
  return top === 'pawn' ? 'a pawn' : `the ${top}`;
}

export function buildFacts(p: Puzzle, countdownSeconds: number): Facts {
  const played: MoveFact = { ...moveFacts([p.played], 'viewer')[0] };
  const refutation = moveFacts(p.refutation, 'opponent');
  const solution = moveFacts(p.solution, 'viewer');
  const squares = new Set<string>();
  for (const m of [played, ...refutation, ...solution]) for (const s of m.san.matchAll(/[a-h][1-8]/g)) squares.add(s[0]);
  const viewerMoves = solution.filter((m) => m.by === 'viewer').length;
  const numbers = new Set<number>([1, countdownSeconds, viewerMoves]);
  if (p.rating) numbers.add(p.rating);
  if (p.fellCount) numbers.add(p.fellCount);
  return {
    format: p.format,
    sideToMove: sideLabel(p.side),
    rating: p.format === 'blunder' ? p.rating : null,
    timeControl: p.format === 'blunder' && p.timeControl && p.timeControl !== 'unknown' ? p.timeControl : null,
    fellCount: p.fellCount,
    played,
    refutation,
    solution,
    motif: p.motifLabel,
    endsInMate: p.mate || (p.refutation.length > 0 && p.refutation[p.refutation.length - 1].san.endsWith('#')),
    refutationWins: biggestCapture(refutation, 'opponent'),
    solutionWins: biggestCapture(solution, 'viewer'),
    countdownSeconds,
    allowedSquares: [...squares].sort(),
    allowedNumbers: [...numbers].sort((a, b) => a - b),
  };
}

// --- guardrails -----------------------------------------------------------------

const LIMITS: Record<BeatId, number> = { hook: 16, challenge: 10, played: 28, refutation: 34, reveal: 34, cta: 18 };
const BANNED = /\b(idiot|stupid|dumb|moron|retard\w*|trash|garbage|loser|f+u+c*k\w*|shit\w*|bitch\w*|damn|hell|kill yourself|magnus|carlsen|hikaru|nakamura|gotham\w*|levy|niemann|chessigma|chess\.com|lichess)\b/i;
const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, million: 1e6,
};

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

function checkText(label: string, text: string, facts: Facts, errors: string[]): void {
  if (/\p{Extended_Pictographic}/u.test(text)) errors.push(`${label}: no emoji`);
  if (/\bELO\b|\belo\b/.test(text)) errors.push(`${label}: write "Elo", never "ELO"/"elo"`);
  if (/[%#@]/.test(text)) errors.push(`${label}: no %, # or @ (no percentages, hashtags or handles)`);
  if (/https?:|www\./i.test(text)) errors.push(`${label}: no links`);
  const banned = BANNED.exec(text);
  if (banned) errors.push(`${label}: "${banned[0]}" is not allowed (no insults, swearing, real people or other sites)`);
  const squares = [...text.matchAll(/\b[a-h][1-8]\b/g)].map((m) => m[0]);
  for (const s of squares) if (!facts.allowedSquares.includes(s)) errors.push(`${label}: square ${s} is not in the facts`);
  const noSquares = text.replace(/\b[a-h][1-8]\b/g, ' ').replace(/patternchess\.com/gi, ' ');
  for (const m of noSquares.matchAll(/\d[\d,]*/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (!facts.allowedNumbers.includes(n)) errors.push(`${label}: the number ${m[0]} is not in the facts`);
  }
  for (const m of noSquares.toLowerCase().matchAll(/\b[a-z]+\b/g)) {
    const n = NUMBER_WORDS[m[0]];
    if (n !== undefined && !facts.allowedNumbers.includes(n)) errors.push(`${label}: "${m[0]}" is a number not in the facts`);
  }
  if (/\bElo\b/.test(text) && !facts.rating) errors.push(`${label}: no rating in the facts, so no Elo`);
}

export type Checked = { ok: true; script: VideoScript } | { ok: false; errors: string[] };

/** Pure: is this a script we can put out under our name? */
export function validateScript(raw: unknown, facts: Facts): Checked {
  const errors: string[] = [];
  const s = raw as Partial<VideoScript> | null;
  if (!s || typeof s !== 'object') return { ok: false, errors: ['not an object'] };
  for (const k of ['hookStyle', 'headline', 'subline', 'captionLead'] as const) {
    if (typeof s[k] !== 'string' || !s[k]!.trim()) errors.push(`${k}: missing`);
  }
  if (!s.beats || typeof s.beats !== 'object') return { ok: false, errors: [...errors, 'beats: missing'] };
  const needed = BEATS.filter((b) => b !== 'refutation' || facts.format === 'fall');
  for (const b of needed) {
    const t = s.beats[b];
    if (typeof t !== 'string' || !t.trim()) {
      errors.push(`beats.${b}: missing`);
      continue;
    }
    if (words(t) > LIMITS[b]) errors.push(`beats.${b}: ${words(t)} words, max ${LIMITS[b]}`);
    checkText(`beats.${b}`, t, facts, errors);
  }
  if (errors.length) return { ok: false, errors };
  if (facts.format === 'blunder' && s.beats.refutation) errors.push('beats.refutation: only for the fall format');
  if (!/PatternChess/.test(s.beats.cta!)) errors.push('beats.cta: must name PatternChess');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.hookStyle!) || s.hookStyle!.length > 32) errors.push('hookStyle: short kebab-case id');
  if (words(s.headline!) > 7 || s.headline!.length > 34) errors.push('headline: at most 7 words / 34 characters');
  if (/\b[a-h][1-8]\b/.test(s.headline!)) errors.push('headline: no squares or moves (it is shown in capitals)');
  if (words(s.subline!) > 8 || s.subline!.length > 40) errors.push('subline: at most 8 words / 40 characters');
  if (s.captionLead!.length > 220) errors.push('captionLead: at most 220 characters');
  for (const k of ['headline', 'subline', 'captionLead'] as const) checkText(k, s[k]!, facts, errors);
  // Nothing before the reveal may give the answer away (the caption is read before the video ends).
  const answer = facts.solution[0];
  const spoilers = [...answer.san.matchAll(/[a-h][1-8]/g)].map((m) => m[0]).filter((sq) => !facts.played.san.includes(sq));
  const early: [string, string][] = [
    ['headline', s.headline!],
    ['subline', s.subline!],
    ['captionLead', s.captionLead!],
    ['beats.hook', s.beats.hook!],
    ['beats.challenge', s.beats.challenge!],
  ];
  for (const [label, t] of early) {
    if (spoilers.some((sq) => new RegExp(`\\b${sq}\\b`).test(t)) || t.toLowerCase().includes(answer.spoken.toLowerCase())) {
      errors.push(`${label}: gives away the answer (${answer.spoken}) before the reveal`);
    }
  }
  if (errors.length) return { ok: false, errors };
  const beats: Partial<Record<BeatId, string>> = {};
  for (const b of needed) beats[b] = s.beats[b]!.trim();
  return {
    ok: true,
    script: { hookStyle: s.hookStyle!, headline: s.headline!.trim(), subline: s.subline!.trim(), beats, captionLead: s.captionLead!.trim() },
  };
}

// --- Claude ---------------------------------------------------------------------

export const SCRIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hookStyle', 'headline', 'subline', 'beats', 'captionLead'],
  properties: {
    hookStyle: { type: 'string' },
    headline: { type: 'string' },
    subline: { type: 'string' },
    captionLead: { type: 'string' },
    beats: {
      type: 'object',
      additionalProperties: false,
      required: ['hook', 'challenge', 'played', 'reveal', 'cta'],
      properties: Object.fromEntries(BEATS.map((b) => [b, { type: 'string' }])),
    },
  },
} as const;

export const SYSTEM_PROMPT = `You write the voiceover for a 20-35 second vertical chess video (Instagram Reels, TikTok) for PatternChess, an app that turns your own blunders into spaced-repetition puzzles.

The video is narrated by an AI voice and the same words appear on screen as captions. Scenes, in order:
- hook (0-3s): the scroll-stopper. Provocative, a little cocky, rage-bait energy, but every claim true. Say it in the first breath.
- challenge: the countdown starts. Tell the viewer to pause and find the move. Very short.
- played: show the move that was played (blunder format: "I played ...", fall format: "Most people play ..."). Say why it looks natural, then that it loses.
- refutation (fall format only): narrate how the opponent punishes it, move by move.
- reveal: the right move and why it works (name the idea: fork, pin, mate, the hanging piece).
- cta: one line that names PatternChess and what it does (it finds the blunders and traps in YOUR games and drills them until they stick).

Rules:
- Use ONLY the facts given. Never invent statistics, percentages, ratings, player counts, move counts or names. The only numbers you may say are in allowedNumbers; the only squares are in allowedSquares.
- Say moves the way they are spoken in the facts ("queen takes h7, check"), never in raw notation like Qxh7+.
- Voice: direct, warm, chess-literate. Playful provocation aimed at the viewer is good ("you'd fall for this too"); insults, swearing and mocking real people are not. Never mention other chess sites, streamers or players.
- Write "Elo" (never "ELO"). No emoji, no hashtags, no links.
- The blunder format is the narrator's own game: first person ("I"). The fall format talks about PatternChess players as a group ("11 PatternChess players played this").
- headline: at most 7 words AND at most 34 characters, the rage-bait line shown big on screen the whole video (e.g. "I'm 2056 and I hung this"; write it in normal case, no moves or squares). subline: at most 8 words and 40 characters, the challenge (e.g. "White to move. Find it.").
- captionLead: one or two sentences for the post caption that invite a comment.
- Never give the answer away before the reveal: the right move must not appear in headline, subline, hook, challenge or captionLead (people read the caption before the video ends).
- hookStyle: a short kebab-case id naming the hook angle (e.g. "rating-shame", "most-people-fail", "would-you-fall").

Hook examples (adapt, don't copy): "I'm rated 2056 and I hung my queen in one move." / "11 PatternChess players fell for this. Would you?" / "Everyone plays this move. It loses on the spot." / "Pause the video. Most people get this wrong."`;

function runClaude(prompt: string, timeoutMs = 180_000): Promise<unknown> {
  // An empty working directory, so no project CLAUDE.md or settings ride along.
  const cwd = mkdtempSync(join(tmpdir(), 'pc-script-'));
  const bin = env('CLAUDE_BIN') ?? 'claude';
  const args = [
    '-p',
    '--model', env('SOCIAL_SCRIPT_MODEL') ?? 'sonnet',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(SCRIPT_SCHEMA),
    '--tools', '',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--system-prompt', SYSTEM_PROMPT,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('claude timed out'));
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      rmSync(cwd, { recursive: true, force: true });
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      rmSync(cwd, { recursive: true, force: true });
      try {
        const env = JSON.parse(out) as { is_error?: boolean; result?: string; structured_output?: unknown };
        if (env.is_error) throw new Error(`claude error: ${String(env.result).slice(0, 300)}`);
        resolve(env.structured_output ?? JSON.parse(env.result ?? ''));
      } catch (e) {
        reject(new Error(`claude exited ${code}: ${(e as Error).message} ${err.slice(0, 300)}`));
      }
    });
    child.stdin.end(prompt);
  });
}

export function scriptPrompt(facts: Facts, previousErrors?: string[]): string {
  const lines = [
    `Write the script for this ${facts.format === 'fall' ? '"would you fall for this?"' : '"blunder of the day"'} video.`,
    '',
    'Facts (JSON):',
    JSON.stringify(facts, null, 2),
  ];
  if (previousErrors?.length) {
    lines.push('', 'Your previous script was rejected by the checker. Fix every one of these:', ...previousErrors.map((e) => `- ${e}`));
  }
  return lines.join('\n');
}

export interface WrittenScript {
  script: VideoScript;
  source: ScriptSource;
  /** Why Claude's attempts were rejected (logged; empty when Claude's script passed). */
  errors: string[];
}

/**
 * Claude first (one retry with the checker's errors), then the template.
 * SOCIAL_SCRIPT_WRITER=template skips Claude (tests, offline renders).
 */
export async function writeScript(p: Puzzle, countdownSeconds: number): Promise<WrittenScript> {
  const facts = buildFacts(p, countdownSeconds);
  const errors: string[] = [];
  if (env('SOCIAL_SCRIPT_WRITER') !== 'template') {
    let last: string[] | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const checked = validateScript(await runClaude(scriptPrompt(facts, last)), facts);
        if (checked.ok) return { script: checked.script, source: 'claude', errors };
        last = checked.errors;
        errors.push(...checked.errors.map((e) => `attempt ${attempt + 1}: ${e}`));
      } catch (e) {
        errors.push(`attempt ${attempt + 1}: ${(e as Error).message}`);
        break; // the CLI itself failed (auth, network): don't burn a retry on it
      }
    }
  }
  const template = templateScript(p, countdownSeconds);
  const checked = validateScript(template, facts);
  if (!checked.ok) throw new Error(`template script fails its own checks: ${checked.errors.join('; ')}`);
  return { script: checked.script, source: 'template', errors };
}
