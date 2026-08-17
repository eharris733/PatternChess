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
                 OpeningsRoute (repertoire builder + practice),
                 EndgamesRoute (dropped-point play-outs),
                 LoginRoute, ProfileRoute, plus dev-only
                 SandboxRoute and EngineTestRoute
  services/      authService, supabaseService, chessApiService, pgnParserService,
                 syncService, analysisService, openingExplorerService,
                 endgameScenarioService, positionFrequencyService,
                 repertoireBuilderService, opponentMoveSampler
  state/         trainingStore, reviewStore, endgamePlayoutStore,
                 openingTrainerStore (all Zustand); shared SR advancement in
                 state/drills/applyDrillResult.ts
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
- **Engine signals**: `evaluatePositionFull(fen, depth=12)` for batch analysis, `evaluateMove(fen, uci, timeMs=500)` for the on-the-fly accept rule, and `analyzeGame(positions, …)` for game-wide blunder detection.
- **Blunder detection** uses the Lichess winning-chances model in `src/chess/winningChances.ts`. Trainable threshold: ≥15% chances lost. On-the-fly accept rule for the training screen: |chancesLost| ≤ 5%.
- **Spaced repetition**: `SPACED_REPETITION_DAYS = [1, 2, 4, 7, 14, 28, 56]` (`src/models/blunder.ts`). Each successful first-attempt drill advances `cycleNumber` by 1; a first-attempt fail resets it to 0 and sets `lastDrillFailed = true`. Retries within the same session don't move the SR state — only the first attempt counts. The canonical implementation is `applyDrillResult` in `src/state/drills/applyDrillResult.ts` — never reimplement the ladder inline.
- **Trainable-item kinds**: `blunders.kind` ∈ `tactic | opening | endgame` (dedup key `(user_id, fen, kind)`; per-kind payload in `drill_data`; `game_id` nullable for opening items). The due queue (`getDueBlunders`) is deliberately **unfiltered** — all kinds interleave at `/training`, and the kind is concealed until the user's first move (that's the product: in a real game you don't know if a position is a book test or a tactic). Game-analysis aggregates (phase/motif/per-game counts, vault, insights) filter `.eq('kind','tactic')`; SR-ladder aggregates (cycle distribution, blunder stats, due counts) stay unified. In `/training`, tactic items use the stored-sequence drill in `trainingStore.processMove`; opening/endgame items render `OpeningDrillView`/`EndgameDrillView`, which drive their own play-out stores and report the outcome via `trainingStore.completeExternalDrill`.
- **Endgame trainer** (`/endgames`): `endgameScenarioService` crosses existing endgame-phase blunders with `resolveOutcome` (dropped win: `missedWin` + loss/draw; dropped draw: `roughlyEqual` + loss), one scenario per game in `endgame_scenarios`. Play-outs run vs the opponent engine at full strength, adjudicated by `src/chess/adjudication.ts` (terminal states via chess.js FIRST — `parseEvalCp` returns an ambiguous 0 there; hold the deserved eval for `HOLD_MOVES = 10` user moves → success; giving up the target result → fail + slip logged as an endgame-kind item).
- **Opening trainer** (`/openings`): repertoire = one move per position per color in `repertoire_moves`, keyed by **EPD** (`toEpd` — FEN minus counters; apply on both write and lookup so transpositions agree). Builder walks positions from the user's games (`positionFrequencyService`, first 30 plies, memory-only index) with masters-book fallback. Practice/queue drills sample opponent replies via `opponentMoveSampler`: own opponents' frequencies at ≥5 samples → Lichess rated-players book in the user's rating band → strength-limited engine. Off-book user moves get the same ≤5% accept rule as tactics; worse ends the line and logs an opening-kind item.
- **Opponent engine**: `getOpponentStockfish()` is the ONLY client that ever receives `setoption` (Skill/Elo). It's shared between the sampler (weakened) and endgame play-outs (which must re-pin `UCI_LimitStrength: 'false'` — `ucinewgame` does not clear option state). Never send `setoption` to `getStockfish()`/`getAnalysisStockfish()`.
- **SR taxonomy** (4 buckets): `new` (never drilled) · `learning` (in the 7-cycle ladder) · `tryAgain` (last drill's first attempt failed) · `mastered` (cycle ≥ 7). Single source of truth: `srBucket()` + `SR_BUCKET_LABEL` in `src/models/blunder.ts`. **Never invent ad-hoc labels** in UI components — always import these. Note: `srBucket(...) === 'mastered'` is just cycle ≥ 7; `isMastered()` adds a recall ≥ 80% check and is used only for the global stats achievement count in `getBlunderStats()`.
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

`stubAuth` in the specs writes a fake Supabase session into `localStorage` and shorts out outbound calls to `*.supabase.co`, so tests don't need a real user. Newer specs: `endgames.spec.ts` (adjudicated play-outs, real engine), `openings.spec.ts` (builder walk, explorer stubbed via `page.route`), `opening_trainer.spec.ts` (practice + queue drills). Gotchas learned the hard way: match `[?&]id=eq.` with a regex (`user_id=eq.` contains `id=eq.` as a substring), and `scrollIntoViewIfNeeded()` before board drags (bottom ranks can sit below the 720px viewport fold).

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

## Pending migrations (apply in the dashboard SQL editor, in order, BEFORE deploying the trainer work)

1. `20260817120000_blunder_kinds.sql` — required first: `insertBlunders` now upserts on `(user_id, fen, kind)` and every aggregate filters on `kind`, so the app 400s against the old schema.
2. `20260817130000_endgame_scenarios.sql`
3. `20260817140000_repertoire.sql`
4. `20260817150000_explorer_cache_key.sql`

Delete this section once they're applied.

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
