# PatternChess

Chess training app using the woodpecker method — drill the blunders from your own games.

Built as a Vite + React + TypeScript SPA. Imports games from chess.com or lichess, runs Stockfish (WASM, in a Web Worker) over them to find blunders, and surfaces them as spaced-repetition drills.

## Quickstart

```bash
npm install
cp .env.example .env.local   # then add your Supabase keys
npm run dev                  # http://localhost:5173
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with COEP/COOP isolation |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the built bundle |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run e2e` | Full Playwright suite |
| `npm run smoke` | Headers + engine smoke specs only |

## What's where

See [`CLAUDE.md`](./CLAUDE.md) for the full layout and conventions.
