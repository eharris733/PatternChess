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
                 LoginRoute, ProfileRoute, plus dev-only
                 SandboxRoute and EngineTestRoute
  services/      authService, supabaseService, chessApiService, pgnParserService,
                 syncService, analysisService, openingExplorerService
  state/         trainingStore (Zustand), reviewStore (Zustand)
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
- **Spaced repetition**: `[1, 2, 4, 7, 14, 28, 56]` days (`src/models/blunder.ts`).
- **Annotation save**: 2-second debounce in `reviewStore.ts`.
- **Opening book**: prefetch first ~22 plies with 300 ms throttle (`useReviewStore.prefetchBook`).
- **Dev-only routes**: `/__sandbox` (chess board sandbox), `/__engine-test` (Stockfish status). Useful for manual checks and Playwright specs.

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

`stubAuth` in the specs writes a fake Supabase session into `localStorage` and shorts out outbound calls to `*.supabase.co`, so tests don't need a real user.

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
