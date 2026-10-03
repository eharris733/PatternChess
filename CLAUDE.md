# PatternChess

Chess training app using the woodpecker method. **Vite + React + TypeScript** SPA targeting Chrome.

## Stack
- Vite 5 + React 18 + TypeScript (strict)
- React Router v6
- Tailwind CSS — palette in `tailwind.config.ts`, dark charcoal/brown
- TanStack Query (server state) + Zustand (training/review state machines)
- `@supabase/supabase-js` (PKCE flow, project `ydfwppthwnlgxnntzrvg`)
- `chess.js` for chess logic / PGN parsing
- `chessground` (Lichess JS) wrapped in a small React component
- Stockfish WASM v18 (nmrugg lite MT primary, lite ST fallback) in a Web Worker

## Project shape

```
src/
  auth/          AuthProvider, RequireAuth, useAuth
  chess/         winningChances (Lichess formula), moveUtils, ChessgroundReact
  components/    AppShell, SidebarNav, BoardPanel, MoveSequencePanel, etc.
  hooks/         useStockfish (singleton init), useGames, useDueBlunders
  lib/           supabase client, queryClient
  models/        Blunder, GameRecord, GameAnnotation, UserProfile, TrainingSession
  routes/        DashboardRoute, TrainingRoute, VaultRoute, ReviewRoute,
                 LeaderboardsRoute, MomentsRoute (public GIF tool),
                 EndgamesRoute (dropped-point play-outs),
                 LoginRoute, ProfileRoute, plus dev-only
                 SandboxRoute and EngineTestRoute
  services/      authService, supabaseService, chessApiService, pgnParserService,
                 syncService, analysisService, openingBookService,
                 endgameScenarioService
  state/         trainingStore, reviewStore, endgamePlayoutStore (all Zustand);
                 shared SR advancement in state/drills/applyDrillResult.ts
  stockfish/     stockfishWorkerClient, uci.ts (parsers)

public/
  stockfish/     stockfish-18-lite.js / .wasm / -single.js / -single.wasm
                 (served at /stockfish/* — do NOT rename)

tests/e2e/       Playwright specs
```

## Setup

1. `npm install`
2. Copy `.env.example` → `.env.local` and set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
3. `npm run dev` — Vite serves at `http://localhost:5173` with the COEP/COOP headers needed for SharedArrayBuffer + Stockfish multi-threading.

## Scripts

- `npm run dev` — Vite dev server with hot reload + cross-origin isolation
- `npm run build` — type check + production build to `dist/`
- `npm run preview` — preview the production build
- `npm run typecheck` — `tsc --noEmit`
- `npm run e2e` — Playwright suite (auto-starts the dev server)
- `npm run smoke` — minimum viable smoke (shell + engine)

## Conventions

- **Routing**: SPA with React Router v6. `/login` is public; everything else is gated by `<RequireAuth>` inside the `<AppShell>` layout.
- **Auth**: PKCE flow with `detectSessionInUrl: true` — Supabase JS handles the `?code=…` exchange automatically. `<AuthProvider>` cleans the URL on `SIGNED_IN` and creates the profile via `authService.getOrCreateProfile()`.
- **Stockfish**: never instantiate the worker directly; call `getStockfish()` (lazy singleton) from `src/hooks/useStockfish.ts`. The client tries the multi-threaded lite engine first, falls back to single-threaded.
- **Engine signals**: `evaluatePositionFull(fen, depth=12)` for batch analysis, `evaluateSmart(fen, { movetimeMs, maxDepth, decidedCp?, decidedMinDepth? })` for "smart depth" evals (`go depth N movetime M` — whichever comes first — plus an early `stop` once a decided score lands; used by endgame play-outs and background deepening), `evaluatePositionTimed(fen, movetimeMs, pvMoves)` for plain fixed-time evals (`bestMoveTimed` delegates to it), and `analyzeGame(positions, …)` for game-wide blunder detection. `stop()` aborts only the active search (queue-safe); `stopOpponentSearch()` in `useStockfish.ts` does it for the opponent singleton. The training screen's on-the-fly accept rule is `evaluatePositionFull(fen, 18)` in `trainingStore`. Every `PositionEval` carries the achieved `depth` (parsed from the last scored info line).
- **Blunder detection** uses the Lichess winning-chances model in `src/chess/winningChances.ts`. Trainable threshold: ≥15% chances lost. On-the-fly accept rule for the training screen: |chancesLost| ≤ 5%.
- **Opening classification** (2026-09-16): a game's opening comes from the board, never from PGN headers — lichess sends `[Opening …]`, chess.com sends only `[ECOUrl …]`, and the two sites assign different ECO codes to the same game. `src/chess/openingClassifier.ts` replays the moves and keeps the **deepest** matching position in `src/generated/openingBook.json` (EPD → `"<eco>|<name>"`, built by `scripts/build-opening-book.mjs` from the CC0 lichess-org/chess-openings TSVs), so transpositions land on the same opening. It writes `games.opening_family` (the grouping key, e.g. "Sicilian Defense") plus canonical `eco`/`opening_name`. Games under `MIN_CLASSIFY_PLIES = 4` (aborts) and non-standard variants (Chess960, Crazyhouse — chess.js can't replay them) stay NULL and drop out of opening stats, which is correct. New games classify at insert via `classifyGameRowsForInsert` (sync + PGN upload); legacy rows are picked up by `startOpeningBackfill` on the dashboard, gated by `opening_classified_at` (stamped even when unclassifiable, so rows are never retried forever). **Never group openings by ECO family again** — `B33`→`B3*` split one opening across up to eight rows and gave unrelated families the same label (the Sicilian spanned eight). The book is a lazy `import()` (~429 KB, 68 KB gzipped); never import the JSON from app code.
- **Spaced repetition**: `SPACED_REPETITION_DAYS = [1, 3, 7, 21]` + `MASTERED_REVIEW_DAYS = 56` (`src/models/blunder.ts`; shortened from a 7-rung/112-day ladder on 2026-09-02 — intervals must stay *expanding*). Index 0 is the new/just-failed interval; `intervalDaysForCycle()` walks the rungs and holds at the 56-day maintenance interval once mastered (mastered positions never leave the queue). Each successful first-attempt drill advances `cycleNumber` by 1; a first-attempt fail resets it to 0 and sets `lastDrillFailed = true`. Retries within the same session don't move the SR state — only the first attempt counts. The canonical implementation is `applyDrillResult` in `src/state/drills/applyDrillResult.ts` — never reimplement the ladder inline.
- **Trainable-item kinds**: `blunders.kind` ∈ `tactic | endgame | opening` (dedup key `(user_id, fen, kind)`; per-kind payload in `drill_data`; `game_id` nullable). The due queue (`getDueBlunders`) is deliberately **unfiltered** — all kinds interleave at `/training`, and tactic/endgame items conceal their kind until the user's first move (that's the product: in a real game you don't know what type of position you're in). **Opening items are the exception** (2026-10-02): they start in trainingStore phase `introducing`, replaying the user's own game up to the position (`introLineTo` in `src/chess/openingLine.ts`, 400 ms/ply, skippable; first showing per session only), then prompt "Play the move for White/Black". `/training` also accepts `location.state.kindFilter` ("Review N due" per kind) and `blunderIds` + `focusLabel` (drill specific positions, due or not, via `getBlundersByIds`). Game-analysis aggregates (phase/motif/per-game counts, vault, insights) filter `.eq('kind','tactic')`; SR-ladder aggregates (cycle distribution, blunder stats, due counts) stay unified. In `/training`, tactic items use the stored-sequence drill in `trainingStore.processMove`; endgame items render `EndgameDrillView`, which drives its own play-out store and reports the outcome via `trainingStore.completeExternalDrill`; opening items reuse the tactic path as single-move drills (`solution_line` NULL, `correct_moves` = the masters theory moves); a correct answer sets `trainingStore.openingVerdict` (`repertoire` | `book` | `sound` — "Great!" / "Good move") rendered by `OpeningVerdictPanel` with **Add to repertoire**, and a miss retries in place (not requeued). Labels come only from `DRILL_KIND_LABEL`. `deleteBlundersForGame` (Vault re-analyze) skips `kind='opening'` — those rows are deduped across games that share one `game_id`.
- **Endgame trainer** (`/endgames`): `endgameScenarioService` crosses existing endgame-phase blunders with `resolveOutcome` (dropped win: `missedWin` + loss/draw; dropped draw: `roughlyEqual` + loss), one scenario per game in `endgame_scenarios`. Play-outs run vs the opponent engine at full strength, adjudicated by `src/chess/adjudication.ts` (terminal states via chess.js FIRST — `parseEvalCp` returns an ambiguous 0 there; giving up the target result → fail + slip optionally logged as an endgame-kind item). Two rule sets: `HOLD_RULES` for queue drills (hold the deserved eval for `HOLD_MOVES = 10` user moves → success) and `FINISH_RULES` for `/endgames` (win = checkmate only, any draw condition fails it; draw = draw by rule or `engineAcceptsDraw` — dead-level at depth with no pawn move/capture for 16 plies, or textbook pawnless material). The store (`endgamePlayoutStore`) keeps the board live while the reference eval runs in the background (`refPending`), commits the engine reply before the next eval, tracks repetition itself, and offers `takeBack()` only when started with `allowTakeBack` (Endgames tab; free). **Endgame scenarios are on the SR ladder** (2026-10-02, migration `20261002130000`): `cycle_number`/`times_*`/`last_drill_failed`/`last_drilled_at`/`next_drill_at` on `endgame_scenarios`, advanced only via `applyScenarioResult` (shares the pure `advanceSr` with `applyDrillResult` — never reimplement the ladder); the first finished play-out per visit is the first attempt, and a pass stays `status='passed'` (rescue achievement). `/endgames` has "Review N due" (a run through due scenarios with "Next due"), `MasteryDots` + `SR_BUCKET_LABEL` per card, and Due/bucket filters. `/endgames` groups scenarios by `classifyEndgameType` (`src/chess/endgameType.ts`; `ENDGAME_TYPE_LABEL` is the only label source).
- **Endgame scenario verification** (2026-09-15): scenarios are still derived engine-free from the depth-12 eval, but `startEndgameScenarioVerification` (`src/services/endgameScenarioVerifier.ts`, mounted on the dashboard and `/endgames`) re-evaluates each new row's `start_fen` with the 3s smart-depth budget and stamps `verified_at` / `verify_eval_cp`; `verdictFor` retires (`retired_at`) dropped draws outside ±150cp or below `DRAW_HOLD_PCT`, and dropped wins under +300cp (already-`passed` rows are never retired). `getEndgameScenarios` and `getEndgameCandidateBlunders` filter `retired_at IS NULL`. It yields to sync analysis and `isMaintenanceRunning()` (same analysis engine).
- **Drill feedback prefs** (2026-09-25): two post-miss settings apply to every drill surface — `showAnswer` (`profiles.show_answer_on_miss`, default off: green best-move arrow + a stepable Solution line) and `autoplay` (`profiles.autoplay_refutation`, default on: after **every** miss, first attempt included, play the refutation of the played move, then the solution when `showAnswer` is on). Read/write them only via `useDrillFeedbackPrefs` (`src/hooks/`; optimistic, shared across mounts) and run autoplay only via `useLineAutoplay` (segments stepped at 700 ms, `stop`/`skip`, `active` for overlays). Toggled from the gear (`DrillSettingsMenu`, rendered by `BoardActionBar`, so any drill using the action bar gets it) and `/profile`. Tactics: `trainingStore.solutionMoves` + `selectSolutionIndex(-1 = arrow)`; endgames: `useSlipLineViewer` builds the solution from `slip.refEvalAtSlip` PV and applies both prefs itself. The "good but not best" retry-in-place never reveals the answer.
- **Repertoire** (2026-10-02): `repertoire_moves` (one move per `(user, color, epd)`, book EPD; migration `20261002120000` restores the definition idempotently — the table already existed remotely). `src/services/db/repertoire.ts` + `useRepertoire`/`useAddToRepertoire`; `TrainingRoute` mirrors it into the store. In an opening drill your saved move is always correct and any other good move is a no-SR "Good move, but your repertoire move is X" nudge. `/openings` cards show "Your repertoire" when it differs from what you played; `findRepertoireExit` (`src/chess/openingLine.ts`) is the helper for flagging games that leave it.
- **Opponent engine**: `getOpponentStockfish()` is the ONLY client that may ever receive `setoption` (Skill/Elo). Endgame play-outs use it and re-pin `UCI_LimitStrength: 'false'` (`ucinewgame` does not clear option state). Never send `setoption` to `getStockfish()`/`getAnalysisStockfish()`.
- **SR taxonomy** (4 buckets): `new` (never drilled) · `learning` (in the 4-cycle ladder) · `tryAgain` (last drill's first attempt failed) · `mastered` (cycle ≥ `SPACED_REPETITION_DAYS.length`, i.e. 4). Single source of truth: `srBucket()` + `SR_BUCKET_LABEL` in `src/models/blunder.ts`. **Never invent ad-hoc labels** in UI components — always import these. Note: `srBucket(...) === 'mastered'` is just cycle ≥ ladder length; `isMastered()` adds a recall ≥ 80% check and is used only for the global stats achievement count in `getBlunderStats()`.
- **Background deepening**: initial sync analysis stays a fast depth-12 pass (onboarding critical path — never make it deeper/slower). `startBlunderMaintenance` (`src/services/blunderEnrichmentBackfill.ts`) runs only while the dashboard is mounted: it enriches legacy rows, then re-analyzes every row (`kind` tactic|endgame) with a 3s-per-position timed budget, rewriting evals/`correct_moves[0]`/`solution_line`/motifs and stamping `analysis_depth` (metadata) + `deepened_at` (the completion gate — time-based, NOT a target depth). Rows the deeper pass scores at <10% chances lost get `retired_at` and drop out of `getDueBlunders` (kept in Vault/stats). It never touches `games.analyzed_at`, and exits while unanalyzed games exist so sync analysis keeps the engine.
- **Public-page performance** (2026-09-02): fonts are self-hosted (`public/fonts/*.woff2` via `scripts/sync-fonts.mjs`, `@font-face` + metric-matched fallbacks in `src/styles/fonts.css`, two preloads in `index.html`) — never re-add the Google Fonts stylesheet. Chessground and its CSS load only with the lazy board chunk (`src/chess/LazyChessgroundReact.tsx` for the landing page; `src/styles/chessground.css` is imported by `chessgroundReact.tsx`, not `index.css`). The landing social-proof card renders from `src/generated/landingStats.json` (refreshed by `scripts/fetch-landing-stats.mjs` in `build`) so it is in the prerendered HTML and never shifts layout. `public/_headers` sets immutable caching for `/assets`, `/fonts`, `/stockfish`. Local Cloudflare preview: `npx wrangler pages dev dist --compatibility-date=2026-06-18` (wrangler 4.100's workerd rejects newer dates).
- **Sounds** (`src/lib/sounds.ts`): everything is synthesized with the Web Audio API — no audio assets (the Lichess sound sets are AGPL; don't vendor them). `BoardPanel` plays move/capture/check off `fen` changes that carry a `lastMove` (pass `sounds={false}` for static preview boards); `TrainingRoute`/`EndgamesRoute` play correct/incorrect on phase changes; `useAchievements` chimes for newly earned ids (seen-set in localStorage). `profiles.sounds_enabled` ("Play sounds" in `/profile`) gates it via `setSoundsEnabled` in `AppShell`; `installSoundUnlock()` resumes the context on the first gesture.
- **Leaderboards** (`/leaderboards`, sidebar entry; 2026-10-03 — achievements stay on their own `/achievements` page (`AchievementsSection`), reached from the trophy (`AchievementsTrophyLink`) next to your name on `/profile`, whose badge counts unlocks not yet seen there (1 / 2 / 3+; `useAchievements().unseenIds` vs the `pc:ach-viewed:<id>` set, cleared by `markViewed()` on `/achievements`, separate from the chime's seen-set); never embed the full grid in the profile, it buries the settings. `/achievements?tab=leaderboards` → `/leaderboards`. The sidebar no longer links Learn or Tournaments; both routes still exist): `leaderboard(metric, win, limit_n)` security-definer RPC (migration `20260915140000`; latest definition `20261002140000` adds `openings` + `endgames`) returns `{ rows: [{rank,label,value,isMe}], me }` — label is lichess → chess.com → display name → "Player"; never ids or emails. Metrics: `solved` (lifetime `sum(times_correct)`; week = `training_sessions.blunders_correct`), `openings` / `endgames` (lifetime `sum(times_correct)` of opening drills / endgame drills + scenarios; week = items whose latest review since Monday was solved — an approximation, per-kind counts aren't logged per session), `mastered` (cycle ≥ 4 and ≥80% recall, same as `getBlunderStats`), `elo` (landing_stats' positive-delta rule per user), `streak` (longest all-time / current this week). `profiles.leaderboard_opt_out` ("Show me on leaderboards", inverted) excludes a user server-side. Client: `src/services/db/leaderboard.ts` + `useLeaderboard` + `LeaderboardPanel`.
- **Opening achievements + flair** (2026-09-26, migration `20260927120000`): `openings` achievement category — reviews opened (`increment_opening_reviews()` via `recordOpeningReview`, counted when opening training starts from `/openings`), opening drills solved/mastered (`getBlunderStats` counts `kind='opening'`), games still in theory at move 10 (`countBookDepthGames` + `stayedInBookThrough`), Learn chapters (`profiles.learn_chapters_done`, distinct keys via `mark_learn_chapter_done(key)`). Consistency adds lifetime `training_totals()` → `{ minutes, activeDays }` (sessions capped at 120 min) for `time-10h/50h` and `active-days-30/100`. The seen-set in `useAchievements` only grows, so a late metric can't re-chime. **Flair** (`src/lib/flair.ts`, `FlairBadge`, `FlairPickerModal`, opened from the flair badge / "Choose flair" chip in the `/profile` header — never a full-page card — and from your own row on `/leaderboards`): cosmetic titles, each unlocked by one achievement id; `profiles.flair` stores the pick, the `leaderboard` RPC returns it per row. Unlocks are client-checked (cosmetic); unknown ids never render.
- **Endgame achievements + daily plan** (2026-10-02): `endgames` achievement category (rescue ids kept for flair, plus `endgamePlayouts`, `endgameSolved`, `endgameMastered`). `DailyHabitCard` adds "Review N openings" (goal `min(OPENINGS_PER_DAY=3, due + done today)`) and the endgame step counts due scenarios. `ChessgroundReact` only redraws on a real size change (seeded with the construction size).
- **Social achievements**: `follow-instagram` unlocks on click-through (`profiles.followed_instagram`, `INSTAGRAM_URL` in `achievements.ts`); `share-1/5/25` count `profiles.shares_count`, bumped by the atomic `increment_shares_count()` RPC — call it only via `recordShare` (`src/share/recordShare.ts`) after any link copy, image/GIF share or download.
- **Referrals** (2026-10-03, migration `20261003120000`): `profiles.referral_code` (8-char public code — invite links never carry ids), `referred_by`, `referrals_count`. Any page stores `?ref=` in localStorage at boot (`captureReferralFromUrl` in `src/lib/referral.ts`; OAuth drops the query string) and `AuthProvider` calls `claim_referral(code)` once after sign-in (credits only accounts < 7 days old, never self). Build links only with `inviteUrl(code, path)`. `InviteCard` on `/leaderboards` ("Invite a friend to compete", your rank as the hook); `invite-1/5` achievements.
- **Share images + GIFs** (`src/share/`, 2026-10-03): pure-canvas renderer (`boardCanvas.ts`: fixed light board, cburnett pieces parsed from chessground's piece CSS, branded footer) feeds PNGs (`renderBoardPng`), GIFs (`gif.ts`, lazy `gifenc`) and the 1200×630 achievement card (`achievementCard.ts`). Shared pieces in `src/components/share/`: `useRenderedImage` (render + per-key cache), `ShareImagePreview`, `ImageShareActions` (Share via Web Share with files / Download / Copy link). Every earned achievement tile opens `ShareImageModal`; the training share modal is ONE dialog with a Link / Screenshot / GIF format toggle — never stack a second modal. Share images follow the player's theme (`readShareTheme()` reads the board + ink/paper tokens; brand mark stays gold) and the Link preview uses the HTML twin `ShareFrame`, so all three formats look identical. GIFs export at 640px so they stay crisp on retina.
- **Moments** (`/moments`, public, prerendered, in the sitemap + landing footer as "Chess GIF maker"): paste a PGN / move list / FEN, pick a ply range (≤ 60), caption, orientation, speed; the live preview is drawn by the same canvas renderer as the export. `ReviewRoute` deep-links with "Make a GIF from here" (`location.state` `{ pgn, from, to, orientation }`; `?pgn=&from=&to=` also works). Signed-out visitors get the sign-up CTA.
- **Book-move copy**: never call a move "book" without who plays it — "N% of players rated 2200+ (OTB) played it here". The phrase comes only from `bookPlayersLabel(tier)` / `BOOK_TIER_MIN_ELO` in `src/chess/bookFormat.ts` (OTB 2200, Elite 2300 = the Lichess Elite floor for the lower-rated player); `playersHeading` in `TheoryMovesLine` for list headings. Book answers in `TheoryMovesLine` render as a share bar chart (user's move green via `highlightUci`); keep the drill verdict headline short ("Great! Nf3 is book.") and let the chart say who plays it. The engine swing (`WinningChancesDisplay`, used in training, shared puzzles, game review, the opening review exit, and endgame slips) is a flat evaluation bar in the Lichess/Chess.com convention: White fills from one end, Black from the other, the board's bottom side on the left; evals print White-relative (+ = White). Pass `mover` (and `orientation` when the board can flip) plus a `label` naming the move — after a correct drill answer it shows the user's own move (`livePlayedEval` with `san`), never the original game move unlabelled.
- **Sync concurrency**: `insertGames` upserts with `ignoreDuplicates` on `(user_id, platform, external_game_id)`; `syncStore` holds a per-provider in-flight promise plus a Web Lock (`patternchess-sync:<provider>`, `ifAvailable`) so StrictMode, the two AuthProvider triggers, "Sync now" mid-analysis, and other tabs never race an insert.
- **Annotation save**: 2-second debounce in `reviewStore.ts`.
- **Review BOOK/NEW tags**: `useReviewStore.prefetchBook` makes one batched `/api/book` request for the first ~22 plies.
- **Opening book** (2026-09-26): self-hosted, replacing the Lichess masters explorer (its per-token rate limit made the `/openings` scan take an hour per user). Data is built offline by the Rust crate `tools/book-builder` (inputs from `scripts/book/download.sh` into gitignored `data/book/`; stages `ingest` → `evals` → `fill` → `vet` → `emit`, each incremental into `data/book/work.sqlite`; **never part of `npm run build`**) and imported into Cloudflare D1 `patternchess-book` (bound as `BOOK` on the Pages project) with `scripts/book/import-d1.sh`, which loads `book_positions_next` and swaps it in. Two **tiers**: `otb` (Lichess broadcasts, both players 2200+, blitz dropped, CC BY-SA 4.0 — credited on `/openings`) and `elite` (Lichess Elite, last 36 months; licence unstated, so confirm with the maintainer before relying on it), replayed to ply 40 and stored at ≥5 games. `pickTier` answers with OTB when it has ≥10 games, else Elite. Every book move is **engine-vetted**: `vet` joins the CC0 Lichess eval DB plus native Stockfish (`fill`, `brew install stockfish`) and marks a move `sound` when it is within 8% winning chances of the best option (looser than the 5% accept bar so gambits like the King's Gambit stay theory); unsound moves never count as theory or get taught. Serving: `functions/api/book.ts` (`POST { fens }`, ≤64, one D1 query) and the dev twin `scripts/devBookProxy.mjs` (reads `data/book/work.sqlite` via `node:sqlite` when present, else forwards to production); both share `src/chess/bookFormat.ts` (wire format, `BOOK_TIER_LABEL`, and the key: the first 53 bits of SHA-1(EPD), so it survives JS numbers — must match `epd_key` in `tools/book-builder/src/book.rs`). **EPD parity is load-bearing**: the builder's EPD must equal chess.js's (en passant only when legally capturable); `tests/fixtures/epd-parity.json` is asserted by both `cargo test` and Vitest. Client: `fetchBook(fens)` in `src/services/openingBookService.ts` (session cache, no throttling). Vite loads the **tracked `vite.config.js`** (a `tsc -b` artifact) over `vite.config.ts` — keep both in sync when editing dev-server config.
- **Openings tab** (`/openings`, 2026-09-25; book v2 2026-09-26): `startOpeningDeviationScan` (`src/services/openingDeviationService.ts`, mounted on the dashboard and `/openings`) fills `opening_deviations` (one row per game) in three stages. **A (network only, may run during sync):** one `fetchBook` per game (`walkFens`), then `findDeviation` in `src/chess/openingDeviation.ts` — the user leaves theory at their first move with < `MIN_MOVE_GAMES` (3) book games (`not_in_book`), a book move the engine vet rejected (`engine_rejected`), or a known line where their side wins < 10% (`losing_line`, only with ≥ `MIN_WINRATE_GAMES` 20 games); positions under `MIN_POSITION_GAMES` (10) or missing are `theory_end` and an opponent exit is `opponent_left` (nobody blamed; both set `book_end_ply`). A failed lookup returns `'retry'` and never stamps the game. Gate: `games.opening_deviation_version` vs `DEVIATION_RULE_VERSION` (now 3) — **bump the version whenever the rules change** so every game is re-walked. **B (engine):** each `user_left` exit is scored before/after the move (`evaluateSmart` 1.5s / depth 18; the book's stored eval of the position is reused when ≥ depth 18). A sound exit (< 10%) hands off to C via `book_end_ply`. **C (past book):** from `book_end_ply` to `MAX_THEORY_PLIES` (**26 = 13 moves**, 2026-09-26), screen the user's moves at 0.3s / depth 14, confirm any ≥ 10% drop at 3s / depth 22, and record the first confirmed one as `user_left` / `past_book` (stamps `past_book_checked_at` either way). Openings show where you *left the opening*, never re-count the tactic pipeline: C stops as soon as `pastBookGate` fails (|eval| > `PAST_BOOK_MAX_EVAL_CP` = 200, either side), never records a position this game's analysis already has as a `kind='tactic'` row (`hasTacticForGamePosition`), only runs on analyzed games, and B hands off only from a level position. Book exits (A/B) always count. After a full drain, `retireOrphanOpeningDrills` retires opening drills no deviation row references (a rule change dropped them); `findDrillForPosition` un-retires one that qualifies again. B and C yield to sync analysis, `isMaintenanceRunning()` and `isEndgameVerificationRunning()`. At ≥ 10% chances lost (lower than the 15% tactic bar, on purpose) it creates a `kind='opening'` drill unless a tactic/opening row already exists for the EPD: `drill_data.source` is `book` (theory moves) or `engine` (engine best + sound book moves; any move within 5% is accepted at runtime anyway). Opening drills are stamped `deepened_at` at creation so the deepening pass (10% retire bar) never touches them. Feedback ("what strong players chose", titled-player share for the OTB tier) renders only through `TheoryMovesLine`; `OpeningTheoryNote` shows after a correct solve, and after a miss only with `showAnswer` on a final attempt. `summarizeDeviations` groups per `(opening_family, colour)` and collapses repeat exits by `(epd, move)` (`gameIds` newest first); `DEVIATION_REASON_LABEL` and `MOVE_CLASSIFICATION_LABEL` are the only label sources. **UI (redesigned 2026-10-02):** `/openings` leads with `OpeningsHero` — the opening that cost the most games (`headlineOpening`/`costlyExitGames`/`typicalExitMove`/`trainableLeaks` in `openingDeviation.ts`) as one sentence plus "Drill these N positions" — then a "Review N due" header button (`kindFilter: 'opening'`), one `OpeningPatternCard` per (family, colour) with a colour swatch, mastery summary and "Drill N", and `DeviationCard`s with `MasteryDots` and Train. Keep text `text-text-primary` (no grayed copy) and percentages to the theory moves only. The game-replay review (`/openings/review/:gameId`, `BookExplorerPanel`) was removed on 2026-10-03 as confusing — old links redirect to `/openings`; a `DeviationCard`'s board and Train button start the drill.
- **Learn library** (`/learn`, `/learn/:slug/:chapter?`): a static, versioned catalog with no DB. You hand-edit `content/learn/catalog.json`; `npm run learn:sync` (`scripts/build-learn.ts`, run manually and **never in `build`**) fetches each enabled study's PGN (or a local `pgnFile`), converts it with `src/learn/pgnToTree.ts` (`@mliebelt/pgn-parser`, devDependency only, so no parser ships to the browser) and writes `src/generated/learn/<slug>.json` (lazy chunk per study via `import.meta.glob`) plus `src/generated/learnCatalog.json` (bundled metadata). **Licensing:** Lichess study text is the author's copyright, so an entry can't be enabled without a `permission` record, every page credits the author and links to the chapter, and a study whose export is disabled (403) fails its entry — never work around it chapter by chapter. The drill (`learnDrillStore`) accepts the main move or any sideline without a ?/??/?! NAG; progress lives in localStorage only (no SR). Opening studies carry `openingFamilies` (validated against the book), which `/openings` uses for "Suggested studies".
- **Dev-only routes**: `/__sandbox` (chess board sandbox), `/__engine-test` (Stockfish status). Useful for manual checks and Playwright specs.
- **Back links**: a sub-page's way back is `<BackLink to label />` (`src/components/BackLink.tsx`, chevron + bordered tap target) — never a tiny greyed "← Back" text link.
- **No emojis in UI**: never render Unicode emoji (fire, checkmarks, etc.) in components. Use inline SVG icons — follow the `BrandMark` pattern in `src/components/BrandLogo.tsx` for hand-written SVGs, or add new ones under `src/components/icons/` (see `FlameIcon` for the established shape: palette constants, `viewBox="0 0 24 24"`, `aria-hidden` by default with optional `title`).

## Where things live

| Concern | File |
|---|---|
| Supabase tables / CRUD | `src/services/supabaseService.ts` (barrel over `src/services/db/*` — games, blunders, endgameScenarios, stats, sessions, profiles, annotations, explorer, benchmarks; import `{ supabaseService }` and call `.method()` as before) |
| Generated DB types | `src/lib/database.types.ts` (`Database`/`Tables`/`TablesInsert`/`TablesUpdate`); client is typed `createClient<Database>` in `src/lib/supabase.ts`, with a `toJson` helper for writing `Json` columns |
| Google OAuth + claim_blunders_for_user | `src/services/authService.ts` |
| Chess.com / Lichess fetch | `src/services/chessApiService.ts` |
| Opening classification (position → name) | `src/chess/openingClassifier.ts` + `src/generated/openingBook.json` (regenerate: `node scripts/build-opening-book.mjs`) |
| Insert-time classify + dashboard backfill | `src/services/openingClassificationService.ts` |
| PGN parsing | `src/services/pgnParserService.ts` |
| Opening book (build, serve, client) | `tools/book-builder/`, `scripts/book/*.sh`, `functions/api/book.ts`, `scripts/devBookProxy.mjs`, `src/chess/bookFormat.ts`, `src/services/openingBookService.ts` |
| Theory-exit rules + aggregation | `src/chess/openingDeviation.ts` |
| Openings scan (walk + engine + past book) | `src/services/openingDeviationService.ts`, `src/services/db/openingDeviations.ts` |
| Learn catalog / importer | `content/learn/catalog.json`, `scripts/build-learn.ts`, `src/learn/` |
| Stockfish UCI bridge | `src/stockfish/stockfishWorkerClient.ts` |
| Lichess winning-chances model | `src/chess/winningChances.ts` |
| Training state machine | `src/state/trainingStore.ts` |
| Review state machine | `src/state/reviewStore.ts` |
| Vite COEP/COOP plugin | `vite.config.ts` |

## Testing

Playwright runs against the live dev server. Specs (`tests/e2e/*.spec.ts`):

Core boot/auth:
- `headers.spec.ts` — COEP/COOP + `crossOriginIsolated`
- `login.spec.ts` — login render + `RequireAuth` redirect
- `sandbox.spec.ts` — board renders + drag e2→e4 updates FEN (`/__sandbox`)
- `engine.spec.ts` — Stockfish boots (MT or ST) and evaluates startpos
- `visual.spec.ts` — every protected route renders inside the shell

Feature flows:
- `training_sequence.spec.ts`, `training_hidden_mode.spec.ts`, `training_prefs_and_upload.spec.ts`, `train_landing.spec.ts` — the training screen (stored-sequence drills, hidden/reveal mode, prefs + PGN upload, landing filters)
- `endgames.spec.ts` — adjudicated play-outs (real engine)
- `vault_filters.spec.ts` — vault filtering
- `analytics.spec.ts`, `dashboard-cards.spec.ts`, `achievements.spec.ts` — dashboard/analytics/insight cards
- `puzzle_share.spec.ts` — `/p?d=` share links
- `moments.spec.ts` — public GIF maker (PGN → GIF/PNG downloads, footer link)
- `openings.spec.ts`, `learn.spec.ts` — `/openings` grouping + colour filter (stubbed `opening_deviations`), `/learn` tabs
- `otb_events.spec.ts` — events integration
- `landing.spec.ts`, `funnel.spec.ts`, `sync_indicator.spec.ts` — public landing + sync onboarding

`npm run smoke` runs the minimum viable subset: `headers.spec.ts` + `engine.spec.ts` (shell boot + engine).

`stubAuth` in the specs writes a fake Supabase session into `localStorage` and shorts out outbound calls to `*.supabase.co`, so tests don't need a real user. Gotchas learned the hard way: match `[?&]id=eq.` with a regex (`user_id=eq.` contains `id=eq.` as a substring), and `scrollIntoViewIfNeeded()` before board drags (bottom ranks can sit below the 720px viewport fold). Note: `landing.spec.ts`, `sync_indicator.spec.ts`, and 3 `dashboard-cards.spec.ts` tests are known-flaky on a clean tree.

### Verifying UI changes

After any UI / behavior change, **start the dev server and exercise the affected
screens with the Playwright MCP** (`mcp__playwright__*` tools) before reporting
the task as done. `npm run typecheck` and the Playwright spec suite verify code
correctness, not feature correctness — they don't catch runtime errors that only
surface at the rendering layer (e.g. chess.js throws on an invalid move,
infinite loading from an unhandled promise, a hidden empty state).

A typical loop:
1. Start `npm run dev` (background).
2. `mcp__playwright__browser_navigate` to `http://localhost:5173`, sign in (or use a stubbed session).
3. Walk through the changed flow and check `mcp__playwright__browser_console_messages` for errors.
4. Take a `mcp__playwright__browser_snapshot` if the visual state matters.

If it can't be tested in a browser, say so explicitly rather than claiming success.

### Sync invariants

- **Already-synced games are not re-fetched.** `syncProvider` calls
  `getExistingGameKeys(platform, username)` and dedupes against
  `(platform|username|opponent|played_at)` before insert.
- **Already-analyzed games are not re-analyzed by sync.** `getUnanalyzedGameIds`
  filters `analyzed_at IS NULL`. Only the per-game "Re-analyze" button in
  `/vault` (which explicitly resets `analyzed_at` and deletes existing blunders)
  can re-analyze a game.

## Migration history note (2026-09-16)

Remote history and `supabase/migrations/` were **reconciled on 2026-09-16** — `supabase db push --dry-run` now reports "Remote database is up to date", and a normal `db push` is safe again. What was done, for reference if it drifts again:

- `supabase migration repair --status applied` for the 12 hand-applied migrations (`20260817120000`, `20260817130000`, `20260829120000`, `20260912120000`–`20260912170000`, `20260915120000`–`20260915140000`).
- `supabase migration repair --status reverted 20260912152006 20260912152300 20260912152313 20260912152724` — those four were duplicate remote-only rows for the same four `20260912*` migrations under different timestamps. Repairing to `reverted` only deletes the history row; it runs nothing and leaves the schema alone.

Note on MCP `apply_migration`: it assigns its **own** version, not the one in your filename (`20260915150000_games_opening_family.sql` landed remotely as `20260915232244`). Rename the local file to the version the remote recorded, or `db push` will treat it as pending.

## Production hosting

Whichever host you pick must send these headers:

```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

Otherwise Stockfish drops to single-threaded only.

## User context
- email: elliotmharris@gmail.com
- Date the rewrite shipped: 2026-04-29
