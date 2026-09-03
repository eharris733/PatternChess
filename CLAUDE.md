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
                 EndgamesRoute (dropped-point play-outs),
                 LoginRoute, ProfileRoute, plus dev-only
                 SandboxRoute and EngineTestRoute
  services/      authService, supabaseService, chessApiService, pgnParserService,
                 syncService, analysisService, openingExplorerService,
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
- **Spaced repetition**: `SPACED_REPETITION_DAYS = [1, 3, 7, 21]` + `MASTERED_REVIEW_DAYS = 56` (`src/models/blunder.ts`; shortened from a 7-rung/112-day ladder on 2026-09-02 — intervals must stay *expanding*). Index 0 is the new/just-failed interval; `intervalDaysForCycle()` walks the rungs and holds at the 56-day maintenance interval once mastered (mastered positions never leave the queue). Each successful first-attempt drill advances `cycleNumber` by 1; a first-attempt fail resets it to 0 and sets `lastDrillFailed = true`. Retries within the same session don't move the SR state — only the first attempt counts. The canonical implementation is `applyDrillResult` in `src/state/drills/applyDrillResult.ts` — never reimplement the ladder inline.
- **Trainable-item kinds**: `blunders.kind` ∈ `tactic | endgame` (dedup key `(user_id, fen, kind)`; per-kind payload in `drill_data`; `game_id` nullable). The due queue (`getDueBlunders`) is deliberately **unfiltered** — all kinds interleave at `/training`, and the kind is concealed until the user's first move (that's the product: in a real game you don't know what type of position you're in). Game-analysis aggregates (phase/motif/per-game counts, vault, insights) filter `.eq('kind','tactic')`; SR-ladder aggregates (cycle distribution, blunder stats, due counts) stay unified. In `/training`, tactic items use the stored-sequence drill in `trainingStore.processMove`; endgame items render `EndgameDrillView`, which drives its own play-out store and reports the outcome via `trainingStore.completeExternalDrill`.
- **Endgame trainer** (`/endgames`): `endgameScenarioService` crosses existing endgame-phase blunders with `resolveOutcome` (dropped win: `missedWin` + loss/draw; dropped draw: `roughlyEqual` + loss), one scenario per game in `endgame_scenarios`. Play-outs run vs the opponent engine at full strength, adjudicated by `src/chess/adjudication.ts` (terminal states via chess.js FIRST — `parseEvalCp` returns an ambiguous 0 there; giving up the target result → fail + slip optionally logged as an endgame-kind item). Two rule sets: `HOLD_RULES` for queue drills (hold the deserved eval for `HOLD_MOVES = 10` user moves → success) and `FINISH_RULES` for `/endgames` (win = checkmate only, any draw condition fails it; draw = draw by rule or `engineAcceptsDraw` — dead-level at depth with no pawn move/capture for 16 plies, or textbook pawnless material). The store (`endgamePlayoutStore`) keeps the board live while the reference eval runs in the background (`refPending`), commits the engine reply before the next eval, tracks repetition itself, and offers `takeBack()` only when started with `allowTakeBack` (Endgames tab; free). `/endgames` groups scenarios by `classifyEndgameType` (`src/chess/endgameType.ts`; `ENDGAME_TYPE_LABEL` is the only label source).
- **Opponent engine**: `getOpponentStockfish()` is the ONLY client that may ever receive `setoption` (Skill/Elo). Endgame play-outs use it and re-pin `UCI_LimitStrength: 'false'` (`ucinewgame` does not clear option state). Never send `setoption` to `getStockfish()`/`getAnalysisStockfish()`.
- **SR taxonomy** (4 buckets): `new` (never drilled) · `learning` (in the 4-cycle ladder) · `tryAgain` (last drill's first attempt failed) · `mastered` (cycle ≥ `SPACED_REPETITION_DAYS.length`, i.e. 4). Single source of truth: `srBucket()` + `SR_BUCKET_LABEL` in `src/models/blunder.ts`. **Never invent ad-hoc labels** in UI components — always import these. Note: `srBucket(...) === 'mastered'` is just cycle ≥ ladder length; `isMastered()` adds a recall ≥ 80% check and is used only for the global stats achievement count in `getBlunderStats()`.
- **Background deepening**: initial sync analysis stays a fast depth-12 pass (onboarding critical path — never make it deeper/slower). `startBlunderMaintenance` (`src/services/blunderEnrichmentBackfill.ts`) runs only while the dashboard is mounted: it enriches legacy rows, then re-analyzes every row (`kind` tactic|endgame) with a 3s-per-position timed budget, rewriting evals/`correct_moves[0]`/`solution_line`/motifs and stamping `analysis_depth` (metadata) + `deepened_at` (the completion gate — time-based, NOT a target depth). Rows the deeper pass scores at <10% chances lost get `retired_at` and drop out of `getDueBlunders` (kept in Vault/stats). It never touches `games.analyzed_at`, and exits while unanalyzed games exist so sync analysis keeps the engine.
- **Public-page performance** (2026-09-02): fonts are self-hosted (`public/fonts/*.woff2` via `scripts/sync-fonts.mjs`, `@font-face` + metric-matched fallbacks in `src/styles/fonts.css`, two preloads in `index.html`) — never re-add the Google Fonts stylesheet. Chessground and its CSS load only with the lazy board chunk (`src/chess/LazyChessgroundReact.tsx` for the landing page; `src/styles/chessground.css` is imported by `chessgroundReact.tsx`, not `index.css`). The landing social-proof card renders from `src/generated/landingStats.json` (refreshed by `scripts/fetch-landing-stats.mjs` in `build`) so it is in the prerendered HTML and never shifts layout. `public/_headers` sets immutable caching for `/assets`, `/fonts`, `/stockfish`. Local Cloudflare preview: `npx wrangler pages dev dist --compatibility-date=2026-06-18` (wrangler 4.100's workerd rejects newer dates).
- **Annotation save**: 2-second debounce in `reviewStore.ts`.
- **Opening book**: prefetch first ~22 plies with 300 ms throttle (`useReviewStore.prefetchBook`).
- **Dev-only routes**: `/__sandbox` (chess board sandbox), `/__engine-test` (Stockfish status). Useful for manual checks and Playwright specs.
- **No emojis in UI**: never render Unicode emoji (fire, checkmarks, etc.) in components. Use inline SVG icons — follow the `BrandMark` pattern in `src/components/BrandLogo.tsx` for hand-written SVGs, or add new ones under `src/components/icons/` (see `FlameIcon` for the established shape: palette constants, `viewBox="0 0 24 24"`, `aria-hidden` by default with optional `title`).

## Where things live

| Concern | File |
|---|---|
| Supabase tables / CRUD | `src/services/supabaseService.ts` |
| Google OAuth + claim_blunders_for_user | `src/services/authService.ts` |
| Chess.com / Lichess fetch | `src/services/chessApiService.ts` |
| PGN parsing | `src/services/pgnParserService.ts` |
| Lichess masters book | `src/services/openingExplorerService.ts` |
| Stockfish UCI bridge | `src/stockfish/stockfishWorkerClient.ts` |
| Lichess winning-chances model | `src/chess/winningChances.ts` |
| Training state machine | `src/state/trainingStore.ts` |
| Review state machine | `src/state/reviewStore.ts` |
| Vite COEP/COOP plugin | `vite.config.ts` |

## Testing

Playwright runs against the live dev server. Specs:
- `headers.spec.ts` — COEP/COOP + `crossOriginIsolated`
- `login.spec.ts` — login render + `RequireAuth` redirect
- `sandbox.spec.ts` — board renders + drag e2→e4 updates FEN
- `engine.spec.ts` — Stockfish boots (MT or ST) and evaluates startpos
- `visual.spec.ts` — every protected route renders inside the shell

`stubAuth` in the specs writes a fake Supabase session into `localStorage` and shorts out outbound calls to `*.supabase.co`, so tests don't need a real user. Newer specs: `endgames.spec.ts` (adjudicated play-outs, real engine). Gotchas learned the hard way: match `[?&]id=eq.` with a regex (`user_id=eq.` contains `id=eq.` as a substring), and `scrollIntoViewIfNeeded()` before board drags (bottom ranks can sit below the 720px viewport fold).

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

## Migration history note (2026-08-29)

The trainer-branch migrations (`20260817120000`, `20260817130000`, `20260829120000`) were applied by hand in the SQL editor and are NOT in the remote migration history — before the next `supabase db push`, run `supabase migration repair --status applied 20260817120000 20260817130000 20260829120000`.

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
