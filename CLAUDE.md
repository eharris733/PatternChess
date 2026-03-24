# PatternChess

Chess training app using the woodpecker method. Flutter Web targeting Chrome.

## Stack
- **Flutter Web** with `chessground` (board UI) and `dartchess` (chess logic/PGN parsing)
- **Supabase** for persistence (project ID: `ydfwppthwnlgxnntzrvg`)
- **Stockfish WASM** via nmrugg/stockfish.js Lite (7MB, NNUE embedded, Web Worker)

## Key Conventions
- Use context7 MCP (`mcp__context7__resolve-library-id` + `mcp__context7__query-docs`) for library documentation
- Use Supabase MCP for migrations and SQL queries (project: `ydfwppthwnlgxnntzrvg`)
- Dark charcoal/brown theme throughout
- No auth/RLS — MVP simplicity
- Four screens: Import, Analysis, Training, Benchmark

## Setup

1. **Flutter** (via Homebrew): `brew install --cask flutter`
2. **Dependencies**: `flutter pub get`
3. **Stockfish WASM** (nmrugg/stockfish.js Lite, ~7MB WASM with embedded NNUE):
   ```bash
   npm install stockfish
   cp node_modules/stockfish/bin/stockfish-18-lite.js web/stockfish/
   cp node_modules/stockfish/bin/stockfish-18-lite.wasm web/stockfish/
   cp node_modules/stockfish/bin/stockfish-18-lite-single.js web/stockfish/
   cp node_modules/stockfish/bin/stockfish-18-lite-single.wasm web/stockfish/
   ```
   Primary: Lite MT (multi-threaded, needs CORS). Fallback: Lite ST (single-threaded).
   No separate NNUE downloads needed — embedded in WASM.
   Other engine variants (full, lichess) kept in web/stockfish/ for benchmark page.

## Dev Server
```bash
./dev.sh              # flutter run with hot reload (fast iteration)
./dev.sh build        # full build + node serve (correct COEP, all engines work)
```

**`./dev.sh`** (default) — uses `flutter run` with hot reload. Stockfish falls back to Lite ST due to Flutter's duplicate COEP headers. Good for UI/logic work.

**`./dev.sh build`** — builds WASM, copies engine files, serves via Node with correct single COEP header. Stockfish uses Lite MT (faster). Use when testing engine performance.

**Why `--wasm`?** `dartchess` uses 64-bit bitboards. Without `--wasm`, Dart compiles to JavaScript which can't represent 64-bit integers.

**Why CORS headers?** Stockfish Lite MT uses pthreads requiring `SharedArrayBuffer`, enabled by CORS isolation headers. Falls back to single-threaded Lite ST automatically.

## Reference Docs
- `docs/chess_com_api.md` — Chess.com API endpoints
- `docs/lichess_api.md` — Lichess API endpoints
- `docs/chessground_usage.md` — Interactive board patterns
- `docs/stockfish_wasm.md` — WASM worker setup and UCI protocol
- `docs/engine_benchmark.md` — Engine benchmark results and recommendations
