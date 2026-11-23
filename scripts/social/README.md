# Daily puzzle video (Instagram Reel + TikTok, through Buffer)

Once a day a narrated, 20–35 second vertical video goes out. The formats alternate by day:

- **Blunder of the day:** one of the owner's own blunders. "I'm rated 2056 and I missed mate in 2."
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

- **Queue rules.** Rows live in `social_posts` (D1 migrations 0003 + 0008). Today is never filled, so a vetoed day stays empty.
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

**Rejects** are stored as `status='rejected'` and never retried. Fall rows use `blunder_id = 'trap:<epd>|<uci>'`.

**Script** (`script.ts`)

- Claude writes the script from a fact sheet: spoken moves, the squares and numbers it may use, what each line wins.
- Claude runs as the **Claude Code CLI on the subscription** (`claude -p --json-schema …`, `CLAUDE_CODE_OAUTH_TOKEN` in CI), never API credits.
- Guardrails reject the script if it has any of:
  - a square or number that isn't in the facts
  - percentages, emoji, "ELO", insults, or real players and sites
  - the answer given away before the reveal
  - lines over the word limits
  - a close that doesn't name PatternChess
- When a script fails, Claude gets one retry with the errors. After that the template in `copy.ts` takes over (`script_source`).

**Voice and render**

- **Voice** (`voice.ts`): Kokoro-82M (Apache-2.0) runs locally on the CPU, for free.
  - Each sentence is synthesized separately, so the timing is exact and the captions need no speech-to-text pass.
  - The voice is `SOCIAL_VOICE`, default `am_michael`. Try `af_heart`, `am_fenrir`, `bm_george` or `am_puck`.
- **Render** (`render.ts`, timing in `timeline.ts`): each scene lasts as long as its animation or its narration, whichever is longer. The narration is mixed over the synthesized move and countdown sounds, which are ducked about 10 dB while the narrator speaks.
- **Upload:** the MP4 and a JPEG poster go to R2 (`patternchess-social`, `https://social.patternchess.com/reels/...`).

### 2. `publish.ts --remote` hands today's row to Buffer

- **Scheduling.** It calls Buffer's GraphQL `createPost` with `mode: customScheduled` and a due time 10 minutes out. Buffer fetches the MP4 from R2 and publishes it as an Instagram Reel and a public TikTok post. Buffer is an audited TikTok partner; our own app isn't, which is why TikTok used to be an inbox draft.
- **Channels are independent.** A failure turns the run red, and a rerun retries only the channel that has no Buffer post yet.
- **Status.** Every run reads back the last 14 days of Buffer posts: `sent` / `error`, plus the Instagram link (`externalLink`).
- **Insights.** When an Instagram token is in KV (`set-token.ts`), it pulls Reel insights by matching that link. Without one, `/analytics` just shows no stats.

**Review:** use the "Daily puzzle video" card on `/analytics` (admin). For each day it shows:
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
SOCIAL_OWNER_EMAIL=<you> npm run social:plan -- --days 2 --local-media /tmp/social   # local D1, no upload
npm run social:plan -- --refresh-queued [--remote]   # re-script/re-voice/re-render queued rows from tomorrow on
npm run social:publish            # local D1, dry unless SOCIAL_MODE=live|draft
node scripts/social/buffer-channels.ts               # Buffer channel ids
npm run typecheck:social && npx vitest run scripts/social
```

**Tools:**
- You need `ffmpeg` and `stockfish` on your PATH (`brew install ffmpeg stockfish`).
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
4. Apply migrations 0003 and 0008 to the remote D1 (see CLAUDE.md, "Database migrations").

### Claude (scripts, on the subscription)

Run `claude setup-token` once, on a Pro/Max account, and store the token as the repository secret `CLAUDE_CODE_OAUTH_TOKEN`. Without it the job still runs and uses the template scripts.

### Buffer

1. Connect the Instagram (professional) and TikTok accounts in Buffer.
2. Create an API key at https://publish.buffer.com/settings/api. It becomes the secret `BUFFER_API_KEY` (and goes in `.env.local` for local runs).
3. Run `node scripts/social/buffer-channels.ts` and copy the Instagram and TikTok channel ids into the repository variables `BUFFER_INSTAGRAM_CHANNEL_ID` / `BUFFER_TIKTOK_CHANNEL_ID`. An unset id skips that channel.

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
  - `BUFFER_INSTAGRAM_CHANNEL_ID`, `BUFFER_TIKTOK_CHANNEL_ID`
  - `IG_API_VERSION` (optional, default `v24.0`)

### Going live

1. Run the workflow by hand with step `refresh`. This re-renders the queued week in the new look.
2. Review the week on `/analytics`.
3. Set `SOCIAL_MODE=draft`, run step `publish`, and check both drafts in Buffer.
4. Set `SOCIAL_MODE=live`.

The old direct posting code (`tiktok.ts`, `tiktok-auth.ts`, `publishReel` in `instagram.ts`) is no longer called.
