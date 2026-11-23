# Daily puzzle video (Instagram Reel + TikTok draft)

Once a day, one of the owner's own blunders becomes a ~14-second vertical
video:
- **0–1s:** the board and the hook are on screen from the first frame ("I blundered this at 2056 blitz. Can you find what I missed?").
- **1–6s:** a 5-second countdown.
- **6–8s:** "What I played" in red.
- **8s on:** "The winning move" played out in green.
- **Last 2s:** back to the start position with the PatternChess line, so the video loops cleanly.

That video goes to two channels:
- **Instagram:** a Reel, published automatically.
- **TikTok:** an **inbox draft**. You open TikTok, add a sound if you like, and tap Post. TikTok only lets audited apps post publicly, and a single-account tool can't pass the audit.

## How it runs

`.github/workflows/social-daily.yml` runs daily at 17:00 UTC (and on demand):

1. **`plan.ts --remote`** keeps the next 7 days queued (`social_posts`, D1 migration 0003).
   - It never fills *today*: a day you veto stays empty instead of getting a puzzle nobody looked at.
   - For each empty day it does the following:
     - **Picks a candidate:** a live tactic row with a deep analysis, a "missed" motif, a real win of +300cp or mate, move 8 or later, and a reveal of 3 or fewer moves. Mates and forks come first, and the same motif never runs two days in a row.
     - **Checks it with Stockfish:** the stored best move must still be the engine's best, and the second-best move must be ≥ 30% winning chances worse. One answer only.
     - **Records rejects** as `status='rejected'` so they are never retried.
     - **Renders and uploads:** the MP4 and a JPEG poster go to R2 (`patternchess-social`, served at `https://social.patternchess.com/reels/...`).
2. **`publish.ts --remote`** posts today's `queued` row.
   - Instagram: container, then wait until it's FINISHED, then `media_publish`.
   - TikTok: `inbox/video/init`, then upload, then wait for `SEND_TO_USER_INBOX`.
   - **The channels are independent.** A failure turns the run red, and a rerun retries only the channel that failed.
   - **Insights:** it then pulls Reel insights (views, reach, likes, comments, saves, shares) for the last 14 days, so `/analytics` can show which hook template works.
   - **Tokens:** it refreshes the Instagram token weekly and the TikTok token as needed. TikTok refresh tokens rotate, so the workflow's concurrency group keeps two runs from racing the pair.

**Review:** use the "Daily puzzle video" card on `/analytics` (admin).
- It shows the next 7 videos (click a poster to play) with **Veto / Restore**.
- It has **Copy TikTok caption**, **Download MP4** (the manual fallback for TikTok), and the last 14 days with stats.

**Gate:** nothing posts until the repository variable `SOCIAL_MODE` is `live`. Any other value makes `publish.ts` log what it would do.

## Local use

```sh
npm run social:render -- --blunder <id> [--remote] [--out dir] [--hook blundered-at]
SOCIAL_OWNER_USER_ID=<uuid> npm run social:plan -- --local-media /tmp/social   # local D1, no upload
npm run social:publish            # local D1, dry unless SOCIAL_MODE=live
npm run typecheck:social && npx vitest run scripts/social
```

You need `ffmpeg` and `stockfish` on your PATH (`brew install ffmpeg stockfish`). Hook templates and captions live only in `copy.ts`; the timing lives only in `timeline.ts`.

## One-time setup

### Cloudflare

1. Create the R2 bucket `patternchess-social`, connect the custom domain `social.patternchess.com`, and add a CORS rule. The rule allows `GET`/`HEAD` from `https://patternchess.com`, `https://*.patternchess-1et.pages.dev` and `http://localhost:5173`. The app is cross-origin isolated (COEP), so the review card loads media with `crossOrigin="anonymous"`.
2. Create the KV namespace `patternchess-social`. Its id becomes the repository variable `SOCIAL_KV_NAMESPACE_ID` (also put it in `.env.local` for the token scripts).
3. Create an API token with **D1 Edit** (patternchess-app), **Workers R2 Storage Edit** and **Workers KV Storage Edit**. That is the secret `CLOUDFLARE_API_TOKEN`; `CLOUDFLARE_ACCOUNT_ID` is the other secret.
4. Apply migration 0003 to the remote D1 (see CLAUDE.md, "Database migrations").

### Instagram (Meta app "PatternChess", Unified login)

Meta no longer offers "API setup with Instagram login" to new apps. The app (1709951037306424) uses the Instagram API use case with **Unified login**, managed by the "Elliot Harris" business portfolio:

1. @patternchess is a professional account with the **Instagram Tester** role (App roles; accepted under Instagram → Settings → Apps and websites → Tester invites).
2. Use cases → Instagram API → configuration "Instagram API (Unified Login)": a **system-user token that never expires**.
3. "Generate access tokens" → **Generate token** for @patternchess (account id 17841418773297346), then store it:
   `pbpaste | node scripts/social/set-token.ts --ig-user-id 17841418773297346`.
   It is saved in KV `ig` with `host: graph.facebook.com`; publish.ts never refreshes these tokens. (An "IG…" Instagram Login token still works: no `--ig-user-id`, host graph.instagram.com, refreshed weekly.)

### TikTok (Content Posting API, Upload mode)

1. Go to developers.tiktok.com and create an app.
   - Add **Login Kit** and the **Content Posting API**. Leave **Direct Post off**.
   - Scopes: `user.info.basic`, `video.upload`.
   - Redirect URI: `https://social.patternchess.com/tiktok-callback`.
   - App URLs: https://patternchess.com, /terms and /privacy.
2. Test in **Sandbox** first, with @patternchess as a target user, then submit for review.
   - Unverified: whether review accepts a single-account uploader. If it doesn't, leave the TikTok secrets unset. The job skips TikTok and you post from **Download MP4**.
3. Add the secrets `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`.
4. With `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` in `.env.local`: run `node scripts/social/tiktok-auth.ts`, open the link, approve, copy the address you land on, then `pbpaste | node scripts/social/tiktok-auth.ts --finish`.

The app (7711150289977804820) runs in its **Sandbox** "patternchess-social" (Login Kit + Content Posting API, `user.info.basic` + `video.upload`, Direct Post off, domain patternchess.com verified by DNS TXT). Its target user is the TikTok account mr_chess_. Use the Sandbox's client key / secret.

### GitHub

- **Secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SOCIAL_OWNER_USER_ID`, and `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` (optional).
- **Variables:** `SOCIAL_KV_NAMESPACE_ID`, `SOCIAL_MODE` (leave unset = dry), and `IG_API_VERSION` (optional, default `v24.0`).

### Going live

Run the workflow once by hand (step `plan`) and review the week on `/analytics`. Then set `SOCIAL_MODE=live`.
