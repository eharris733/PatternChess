# PatternChess

Chess training app using the woodpecker method. Flutter Web targeting Chrome.

## Stack
- **Flutter Web** with `chessground` (board UI) and `dartchess` (chess logic/PGN parsing)
- **Supabase** for persistence (project ID: `ydfwppthwnlgxnntzrvg`)
- **Stockfish WASM** for position evaluation via JS interop

## Key Conventions
- Use context7 MCP (`mcp__context7__resolve-library-id` + `mcp__context7__query-docs`) for library documentation
- Use Supabase MCP for migrations and SQL queries (project: `ydfwppthwnlgxnntzrvg`)
- Dark charcoal/brown theme throughout
- No auth/RLS — MVP simplicity
- Three screens only: Import, Analysis, Training

## Reference Docs
- `docs/chess_com_api.md` — Chess.com API endpoints
- `docs/lichess_api.md` — Lichess API endpoints
- `docs/chessground_usage.md` — Interactive board patterns
- `docs/stockfish_wasm.md` — WASM worker setup and UCI protocol
