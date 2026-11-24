# Social videos (Instagram Reels, TikTok and YouTube Shorts, through Buffer)

Twice a day a narrated, 20–35 second vertical video goes out (slots in `series.ts`):

- **Slot 0, ~12:10 ET (17:10 UTC): the puzzle.** Its two formats alternate by day (below).
- **Slot 1, ~18:30 ET (23:30 UTC): "Blunders decide games".** A famous player's deciding blunder, rebuilt on our board from the public game record (never broadcast footage): the board before the blunder with broadcast-style name bars, the blunder, then the viewer (the winner) finds the punishment. CTA: "Blunders decide games. Fix yours."

The puzzle formats:

- **Blunder of the day:** one of the owner's own blunders, told in the third person. "A 2056 player missed mate in 2. Can you?"
- **Would you fall for this?:** a move that at least 3 different PatternChess players, in at least 3 different games, got wrong in the same position. "11 PatternChess players fell for this. Would you?" Only the position, the move and the count are used: never who played it.

Each video runs in six steps:

1. **Hook:** the board and the headline are on screen from the first frame, and the narrator says the hook.
2. **Countdown:** 5 seconds, with the challenge line spoken over it.
3. **The move:** the move that was played, or the one most people play, in red with "??".
4. **The punishment** (fall only): the opponent's refutation, move by move.
5. **The reveal:** the right move and its line in green.
6. **End card:** the PatternChess card over the start position, so the video loops.

The look matches the site: paper background, ink text, mono uppercase headline, the board with a 2px ink border and hard shadow (scaled up), gold accents, and the serif Pattern*Chess* wordmark (`assets/wordmark.png`, rendered by `make-wordmark.ts`). The narrator's words are captioned, with the current word highlighted in gold.

## How it runs

`.github/workflows/social-daily.yml` runs daily at 17:00 UTC (and on demand).

### 1. `plan.ts --remote` keeps the next 7 days queued

- **Queue rules.** Rows live in `social_posts` (D1 migrations 0003 + 0008 + 0009), one live row per `(scheduled_for, slot)`. Today is never filled, so a vetoed slot stays empty.
- **Formats.** Even day numbers prefer blunder, odd ones prefer fall. If the preferred format has nothing that passes, the day gets the other.

**Blunder candidates**

- A blunder candidate needs all of:
  - a live tactic row with deep analysis
  - a "missed" motif
  - a real win of +300cp or mate
  - move 8 or later
  - a reveal of at most 3 moves
- Stockfish then checks for one answer only: the stored best move must still be the engine's best, and the runner-up must be at least 30% winning chances worse.

**Fall candidates**

- Fall candidates come from `fetchFallCandidates`, grouped by EPD and move across all users. Openings come first.
- Stockfish checks that the tempting move throws away at least 30 points of winning chances. The engine's line after it is the punishment the video plays.

**Pro candidates** ("Blunders decide games", `pros.ts` + `proScan.ts`)

- Games come from chess.com's public archives (this and last month) for the roster in `PRO_PLAYERS`. Both players must be on the roster (names come only from there, checked against their chess.com profiles), someone won on the board (resigned / checkmated, not on time), standard chess, bullet / blitz / rapid. Famous pairings and recent games first.
- Each game is screened move by move (150 ms per position, one long-lived Stockfish): the first move by the loser that drops their winning chances by at least 30 points from at least 40%.
- The punishment must pass the blunder format's one-answer check (4 s, two lines). The reveal says the winner found it only when they did.
- Lichess broadcasts (OTB) are a follow-up: their round PGNs came back without moves on 2026-11-23.

**Rejects** are stored as `status='rejected'` and never retried. Fall rows use `blunder_id = 'trap:<epd>|<uci>'`; pro rows `pro:chesscom:<game id>`.

**Script** (`script.ts`)

- Claude writes the script from a fact sheet: spoken moves, the squares and numbers it may use, what each line wins.
- **Hook angles** (`hooks.ts`): every video gets an assigned angle ("pause-now", "one-move", "engine-laughed", "rating-check", "would-you-fall", …), the eligible one used least recently in the last 14 days of the queue. The fact sheet also carries those recent hooks, and the script must open with different words. The angle id is stored as `hook_template`, so insights compare angles. Add an angle there plus its template in `copy.ts` (a test checks every angle has one).
- **No first person:** the narrator is an AI voice for PatternChess, so "I", "me" and "my" are rejected everywhere ("White played…", "a 2056 player", "you").
- Claude runs as the **Claude Code CLI on the subscription** (`claude -p --json-schema …`, `CLAUDE_CODE_OAUTH_TOKEN` in CI), never API credits.
- Guardrails reject the script if it has any of:
  - a square or number that isn't in the facts
  - percentages, emoji, "ELO", insults, or real players and sites
  - the answer given away before the reveal
  - lines over the word limits
  - a close that doesn't name PatternChess
  - first person, a hook style other than the assigned angle, or a headline / hook that opens like a recent one
- When a script fails, Claude gets one retry with the errors. After that the template in `copy.ts` takes over (`script_source`).

**Voice and render**

- **Voice** (`voice.ts`): Kokoro-82M (Apache-2.0) runs locally on the CPU, for free.
  - Each sentence is synthesized separately, so the timing is exact and the captions need no speech-to-text pass.
  - The voice is `SOCIAL_VOICE` (`am_fenrir` since 2026-11-24, picked from the audition; the code default is `am_michael`). `node scripts/social/voice-audition.ts --out <dir>` renders one narration in several voices to compare.
- **Render** (`render.ts`, timing in `timeline.ts`): each scene lasts as long as its animation or its narration, whichever is longer. The narration is mixed over the synthesized move and countdown sounds, which are ducked about 10 dB while the narrator speaks.
- **Upload:** the MP4 and a JPEG poster go to R2 (`patternchess-social`, `https://social.patternchess.com/reels/...`).

### 2. `publish.ts --remote` hands today's rows to Buffer

- **Scheduling.** For each of today's slots it calls Buffer's GraphQL `createPost` with `mode: customScheduled`, due at the slot's time (never sooner than 10 minutes out), so the one 17:00 UTC run schedules both. Buffer fetches the MP4 from R2 and publishes it as an Instagram Reel, a public TikTok post and a public YouTube Short (title from the script's `youtubeTitle`, category Gaming, `isAiGenerated: true` for the synthetic voice). Buffer is an audited TikTok partner; our own app isn't, which is why TikTok used to be an inbox draft.
- **Channels are independent.** A failure turns the run red, and a rerun retries only the channel that has no Buffer post yet.
- **Status.** Every run reads back the last 14 days of Buffer posts: `sent` / `error`, plus the Instagram link (`externalLink`).
- **Insights.** When an Instagram token is in KV (`set-token.ts`), it pulls Reel insights by matching that link. Without one, `/analytics` just shows no stats.

**Review:** use the "Social videos" card on `/analytics` (admin). For each day and slot it shows:
- the video (click the poster to play)
- the format and the puzzle
- the **voiceover script** (folded), who wrote it, and the voice
- the Buffer status and any errors
- **Veto / Restore**

**Gate:** `SOCIAL_MODE` (repository variable) decides what `publish.ts` does:
- `live` schedules in Buffer.
- `draft` makes Buffer drafts. Nothing publishes and nothing is recorded, so reruns make new drafts.
- Anything else only logs.

## Local use

```sh
npm run social:render -- --blunder <id> [--template] [--no-voice] [--out dir]
npm run social:render -- --trap "<fen>|<uci>" --players 11
npm run social:render -- --pro [skip]                  # the best pro game this month whose blunder makes a clean puzzle
SOCIAL_OWNER_EMAIL=<you> npm run social:plan -- --days 2 --local-media /tmp/social   # local D1, no upload
npm run social:plan -- --refresh-queued [--remote]   # re-script/re-voice/re-render queued rows from tomorrow on
npm run social:publish            # local D1, dry unless SOCIAL_MODE=live|draft
node scripts/social/buffer-channels.ts               # Buffer channel ids
npm run typecheck:social && npx vitest run scripts/social
```

**Tools:**
- You need `ffmpeg` and `stockfish` on your PATH (`brew install ffmpeg stockfish`).
- Install the narrator once with `ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm i --no-save kokoro-js@1.2.1`. It is deliberately not in `package.json`: onnxruntime-node is about 220 MB and would slow every Pages build. `npm ci` removes it again.
- Claude scripts use your local `claude` login. `--template` (or `SOCIAL_SCRIPT_WRITER=template`) skips Claude.
- The Kokoro model downloads once into `~/.cache/patternchess-tts`.

**Where things live:**
- Fixed copy (templates, end card, caption tail, tags): `copy.ts`.
- The script rules: `script.ts`.
- The timing: `timeline.ts`.

## One-time setup

### Cloudflare

1. Create the R2 bucket `patternchess-social`, connect the custom domain `social.patternchess.com`, and add a CORS rule (`wrangler r2 bucket cors set patternchess-social --file …`).
   - **Origins:** allows `GET`/`HEAD` from `https://patternchess.com`, `https://*.patternchess-1et.pages.dev`, `http://localhost:5173`, `https://publish.buffer.com` and `https://*.buffer.com`.
   - **Exposed headers:** `Content-Length`, `Content-Range`, `Accept-Ranges`, `Content-Type`.
   - **Why:** the app is cross-origin isolated (COEP), so the review card loads media with `crossOrigin="anonymous"`. Buffer's composer preview also loads the video cross-origin, so it stays blank without the Buffer origins (added 2026-11-23).
2. Create the KV namespace `patternchess-social`. Its id becomes the repository variable `SOCIAL_KV_NAMESPACE_ID` (also put it in `.env.local` for the token scripts).
3. Create an API token with **D1 Edit** (patternchess-app), **Workers R2 Storage Edit** and **Workers KV Storage Edit**. That is the secret `CLOUDFLARE_API_TOKEN`; `CLOUDFLARE_ACCOUNT_ID` is the other secret.
4. Apply migrations 0003, 0008 and 0009 to the remote D1 (see CLAUDE.md, "Database migrations").

### Claude (scripts, on the subscription)

Run `claude setup-token` once, on a Pro/Max account, and store the token as the repository secret `CLAUDE_CODE_OAUTH_TOKEN`. Without it the job still runs and uses the template scripts.

### Buffer

1. Connect the Instagram (professional), TikTok and YouTube accounts in Buffer (the free plan's 3 channels).
2. Create an API key at https://publish.buffer.com/settings/api. It becomes the secret `BUFFER_API_KEY` (and goes in `.env.local` for local runs).
3. Run `node scripts/social/buffer-channels.ts` and copy the channel ids into the repository variables `BUFFER_INSTAGRAM_CHANNEL_ID` / `BUFFER_TIKTOK_CHANNEL_ID` / `BUFFER_YOUTUBE_CHANNEL_ID`. An unset id skips that channel.

### Instagram insights (optional)

Insights still read the Instagram Graph API. The Meta app (1709951037306424, Unified login, managed by the "Elliot Harris" business portfolio) has a system-user token for @patternchess (account id 17841418773297346). Store it with:

`pbpaste | node scripts/social/set-token.ts --ig-user-id 17841418773297346`

It goes in KV `ig`. Without it, no stats show on `/analytics`.

### GitHub

- **Secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SOCIAL_OWNER_USER_ID`, `CLAUDE_CODE_OAUTH_TOKEN`, `BUFFER_API_KEY`.
- **Variables:**
  - `SOCIAL_KV_NAMESPACE_ID`
  - `SOCIAL_MODE` (unset = dry)
  - `SOCIAL_VOICE` (optional)
  - `BUFFER_INSTAGRAM_CHANNEL_ID`, `BUFFER_TIKTOK_CHANNEL_ID`, `BUFFER_YOUTUBE_CHANNEL_ID`
  - `IG_API_VERSION` (optional, default `v24.0`)

### Going live

1. Run the workflow by hand with step `refresh`. This re-renders the queued week in the new look.
2. Review the week on `/analytics`.
3. Set `SOCIAL_MODE=draft`, run step `publish`, and check both drafts in Buffer. The `day` input (`--day YYYY-MM-DD`, draft / dry only) previews an upcoming day's video when today has none. A live run always posts today's.
4. Set `SOCIAL_MODE=live`.

The old direct posting code (`tiktok.ts`, `tiktok-auth.ts`, `publishReel` in `instagram.ts`) is no longer called.
