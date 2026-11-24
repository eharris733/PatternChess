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
import { openingWords, pickAngle, type RecentHook } from './hooks.ts';
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
  /** The YouTube Short's title (no spoiler). Older stored scripts lack it; copy.ts falls back to the headline. */
  youtubeTitle?: string;
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
  /** blunder: the move that was played. fall: the move most people play. */
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
  /** The hook angle this video must use (rotated, see hooks.ts). */
  angle: { id: string; brief: string; example: string };
  /** The hooks already in the queue, newest first: open differently from all of them. */
  recentHooks: { headline: string; hook: string }[];
  /** pro only: the two players (the only real people the script may name), the event, who blundered. */
  pro: {
    white: { name: string; short: string; title: string | null; rating: number | null };
    black: { name: string; short: string; title: string | null; rating: number | null };
    event: string;
    year: number;
    blunderer: string;
    /** The blunderer's title ("GM"), for the even-grandmasters angle. */
    blundererTitle: string | null;
    winner: string;
    /** The winner found the punishment in the game. */
    foundInGame: boolean;
  } | null;
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

export function buildFacts(p: Puzzle, countdownSeconds: number, recent: readonly RecentHook[] = []): Facts {
  // pro: the viewer plays the winner, so the blunder is the opponent's move.
  const played: MoveFact = { ...moveFacts([p.played], p.format === 'pro' ? 'opponent' : 'viewer')[0] };
  const refutation = moveFacts(p.refutation, 'opponent');
  const solution = moveFacts(p.solution, 'viewer');
  const squares = new Set<string>();
  for (const m of [played, ...refutation, ...solution]) for (const s of m.san.matchAll(/[a-h][1-8]/g)) squares.add(s[0]);
  const viewerMoves = solution.filter((m) => m.by === 'viewer').length;
  const numbers = new Set<number>([1, countdownSeconds, viewerMoves]);
  if (p.rating) numbers.add(p.rating);
  if (p.fellCount) numbers.add(p.fellCount);
  if (p.pro) {
    for (const r of [p.pro.white.rating, p.pro.black.rating, p.pro.year]) if (r) numbers.add(r);
  }
  const pro = p.pro
    ? {
        white: p.pro.white,
        black: p.pro.black,
        event: p.pro.event,
        year: p.pro.year,
        blunderer: p.pro[p.pro.blunderer].short,
        blundererTitle: p.pro[p.pro.blunderer].title,
        winner: p.pro[p.pro.blunderer === 'white' ? 'black' : 'white'].short,
        foundInGame: p.pro.foundInGame,
      }
    : null;
  const rating = p.format === 'blunder' ? p.rating : null;
  const endsInMate = p.mate || (p.refutation.length > 0 && p.refutation[p.refutation.length - 1].san.endsWith('#'));
  const solutionWins = biggestCapture(solution, 'viewer');
  const angle = pickAngle(
    {
      format: p.format,
      rating,
      endsInMate,
      solutionWins,
      fellCount: p.fellCount,
      pro,
    },
    recent.map((r) => r.hookStyle),
    p.blunderId,
  );
  return {
    format: p.format,
    sideToMove: sideLabel(p.side),
    rating,
    timeControl: p.format === 'blunder' && p.timeControl && p.timeControl !== 'unknown' ? p.timeControl : null,
    fellCount: p.fellCount,
    played,
    refutation,
    solution,
    motif: p.motifLabel,
    endsInMate,
    refutationWins: biggestCapture(refutation, 'opponent'),
    solutionWins,
    countdownSeconds,
    allowedSquares: [...squares].sort(),
    allowedNumbers: [...numbers].sort((a, b) => a - b),
    angle: { id: angle.id, brief: angle.brief, example: angle.example },
    recentHooks: recent.slice(0, 14).map((r) => ({ headline: r.headline, hook: r.hook })),
    pro,
  };
}

/** pro: the players' names may be said; every other real name stays banned. */
function withoutPlayerNames(text: string, facts: Facts): string {
  if (!facts.pro) return text;
  const words = new Set<string>();
  for (const pl of [facts.pro.white, facts.pro.black]) {
    for (const w of `${pl.name} ${pl.short}`.split(/[\s-]+/)) if (w.length >= 3) words.add(w.toLowerCase());
  }
  return text.replace(/[\p{L}]+/gu, (w) => (words.has(w.toLowerCase()) ? ' ' : w));
}

// --- guardrails -----------------------------------------------------------------

const LIMITS: Record<BeatId, number> = { hook: 16, challenge: 10, played: 28, refutation: 34, reveal: 34, cta: 18 };
const BANNED = /\b(idiot|stupid|dumb|moron|retard\w*|trash|garbage|loser|f+u+c*k\w*|shit\w*|bitch\w*|damn|hell|kill yourself|magnus|carlsen|hikaru|nakamura|gotham\w*|levy|niemann|chessigma|chess\.com|lichess)\b/i;
const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, million: 1e6,
};

const FIRST_PERSON = /\b(I|I'm|I’m|I've|I'd|I'll)(?![\w'’])/;
const FIRST_PERSON_CI = /\b(me|my|mine|myself)\b/i;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

function checkText(label: string, text: string, facts: Facts, errors: string[]): void {
  if (/\p{Extended_Pictographic}/u.test(text)) errors.push(`${label}: no emoji`);
  if (/\bELO\b|\belo\b/.test(text)) errors.push(`${label}: write "Elo", never "ELO"/"elo"`);
  if (/[%#@]/.test(text)) errors.push(`${label}: no %, # or @ (no percentages, hashtags or handles)`);
  if (/https?:|www\./i.test(text)) errors.push(`${label}: no links`);
  const banned = BANNED.exec(withoutPlayerNames(text, facts));
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
  const me = FIRST_PERSON.exec(text) ?? FIRST_PERSON_CI.exec(text);
  if (me) errors.push(`${label}: "${me[0]}" is first person; the narrator never says I, me or my`);
}

export type Checked = { ok: true; script: VideoScript } | { ok: false; errors: string[] };

/** Pure: is this a script we can put out under our name? */
export function validateScript(raw: unknown, facts: Facts): Checked {
  const errors: string[] = [];
  const s = raw as Partial<VideoScript> | null;
  if (!s || typeof s !== 'object') return { ok: false, errors: ['not an object'] };
  for (const k of ['hookStyle', 'headline', 'subline', 'captionLead', 'youtubeTitle'] as const) {
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
  if (facts.format !== 'fall' && s.beats.refutation) errors.push('beats.refutation: only for the fall format');
  if (!/PatternChess/.test(s.beats.cta!)) errors.push('beats.cta: must name PatternChess');
  if (facts.format === 'pro' && !/\bfix yours\b/i.test(s.beats.cta!)) errors.push('beats.cta: pro videos end on "Fix yours" (blunders decide games)');
  if (s.youtubeTitle!.length > 90) errors.push('youtubeTitle: at most 90 characters');
  if (s.hookStyle !== facts.angle.id) errors.push(`hookStyle: must be "${facts.angle.id}" (the assigned angle)`);
  const opening = openingWords(s.headline!);
  const clash = facts.recentHooks.find((r) => openingWords(r.headline) === opening || openingWords(r.hook) === openingWords(s.beats!.hook!));
  if (clash) errors.push(`headline / beats.hook: opens like a recent video ("${clash.headline}" / "${clash.hook}"); start differently`);
  if (words(s.headline!) > 7 || s.headline!.length > 34) errors.push('headline: at most 7 words / 34 characters');
  if (/\b[a-h][1-8]\b/.test(s.headline!)) errors.push('headline: no squares or moves (it is shown in capitals)');
  if (words(s.subline!) > 8 || s.subline!.length > 40) errors.push('subline: at most 8 words / 40 characters');
  if (s.captionLead!.length > 220) errors.push('captionLead: at most 220 characters');
  for (const k of ['headline', 'subline', 'captionLead', 'youtubeTitle'] as const) checkText(k, s[k]!, facts, errors);
  // Nothing before the reveal may give the answer away (the caption is read before the video ends).
  const answer = facts.solution[0];
  const spoilers = [...answer.san.matchAll(/[a-h][1-8]/g)].map((m) => m[0]).filter((sq) => !facts.played.san.includes(sq));
  const early: [string, string][] = [
    ['headline', s.headline!],
    ['subline', s.subline!],
    ['captionLead', s.captionLead!],
    ['youtubeTitle', s.youtubeTitle!],
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
    script: {
      hookStyle: s.hookStyle!,
      headline: s.headline!.trim(),
      subline: s.subline!.trim(),
      beats,
      captionLead: s.captionLead!.trim(),
      youtubeTitle: s.youtubeTitle!.trim(),
    },
  };
}

// --- Claude ---------------------------------------------------------------------

export const SCRIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hookStyle', 'headline', 'subline', 'beats', 'captionLead', 'youtubeTitle'],
  properties: {
    hookStyle: { type: 'string' },
    youtubeTitle: { type: 'string' },
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

export const SYSTEM_PROMPT = `You write the voiceover for a 20-35 second vertical chess video (Instagram Reels, TikTok, YouTube Shorts) for PatternChess, an app that turns your own blunders into spaced-repetition puzzles.

The video is narrated by an AI voice speaking for PatternChess, and the same words appear on screen as captions. Scenes, in order:
- hook (0-3s): the scroll-stopper, in the angle you are given (facts.angle). Provocative, a little cocky, but every claim true. Say it in the first breath.
- challenge: the countdown starts. Tell the viewer to pause and find the move. Very short.
- played: show the move that was played (blunder format: "White played ...", fall format: "Most people play ..."). Say why it looks natural, then that it loses.
- refutation (fall format only): narrate how the opponent punishes it, move by move.
- reveal: the right move and why it works (name the idea: fork, pin, mate, the hanging piece).
- cta: one line that names PatternChess and what it does (it finds the blunders and traps in YOUR games and drills them until they stick).

Rules:
- The narrator is not a person and never speaks in the first person: no "I", "I'm", "me", "my" anywhere (beats, headline, subline, captionLead). Talk about the side ("White played..."), "the player", "a 2056 player", or the viewer ("you", "your move").
- Use ONLY the facts given. Never invent statistics, percentages, ratings, player counts, move counts or names. The only numbers you may say are in allowedNumbers; the only squares are in allowedSquares.
- Say moves the way they are spoken in the facts ("queen takes h7, check"), never in raw notation like Qxh7+.
- Voice: direct, warm, chess-literate. Playful provocation aimed at the viewer is good ("you'd fall for this too"); insults, swearing and mocking real people are not. Never mention other chess sites, streamers or players.
- Write "Elo" (never "ELO"). No emoji, no hashtags, no links.
- The fall format talks about PatternChess players as a group ("11 PatternChess players played this").
- The pro format ("Blunders decide games") is a real game between two famous players (facts.pro). The viewer plays the winner: the opponent just blundered (played), and the viewer must find the punishment (solution). Name the two players only as given (facts.pro short names or full names, titles); no other real people. Respectful: even the best blunder, that is the point; never mock them. Scenes in this format: hook, played (narrate the blunder: "Hikaru played ..."), challenge (find the punishment), reveal (the punishment and why it wins; say the winner found it in the game only when facts.pro.foundInGame is true). The cta must contain "Fix yours" and PatternChess (e.g. "Blunders decide games. PatternChess finds yours. Fix yours now.").
- Hook angle: use facts.angle (its brief and example; adapt the example, don't copy it word for word). hookStyle must be exactly facts.angle.id.
- Variety: facts.recentHooks are the videos already in the feed. Your headline and hook must not start with the same three words as any of them, and should not reuse their phrasing.
- headline: at most 7 words AND at most 34 characters, the hook line shown big on screen the whole video, in the same angle (normal case, no moves or squares). subline: at most 8 words and 40 characters, the challenge (e.g. "White to move. Find it.").
- captionLead: one or two sentences for the post caption that invite a comment.
- youtubeTitle: the YouTube Shorts title, at most 90 characters, searchable and specific (pro: include both players' names), no spoiler.
- Never give the answer away before the reveal: the right move must not appear in headline, subline, hook, challenge, captionLead or youtubeTitle (people read the caption before the video ends).`;

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
    `Write the script for this ${facts.format === 'fall' ? '"would you fall for this?"' : facts.format === 'pro' ? '"Blunders decide games"' : '"blunder of the day"'} video.`,
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
export async function writeScript(p: Puzzle, countdownSeconds: number, recent: readonly RecentHook[] = []): Promise<WrittenScript> {
  const facts = buildFacts(p, countdownSeconds, recent);
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
  // The template follows the assigned angle; its wording is fixed, so it skips the "open differently" check.
  const template = templateScript(p, countdownSeconds, facts);
  const checked = validateScript(template, { ...facts, recentHooks: [] });
  if (!checked.ok) throw new Error(`template script fails its own checks: ${checked.errors.join('; ')}`);
  return { script: checked.script, source: 'template', errors };
}
