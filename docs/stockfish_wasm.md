# Stockfish WASM Integration

## Architecture
- Stockfish runs in a Web Worker to avoid blocking the UI thread
- Communication via `postMessage` / `onmessage`
- UCI protocol for all commands

## Setup

### 1. Download Stockfish 18 WASM
```bash
npm pack stockfish@18.0.5
tar -xzf stockfish-18.0.5.tgz
cp package/bin/stockfish-18-lite-single.js web/stockfish/
cp package/bin/stockfish-18-lite-single.wasm web/stockfish/
rm -rf package stockfish-18.0.5.tgz
```

Source: [nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js) (npm package: `stockfish`)

### 2. Available Builds

| Build | Files | Size | Notes |
|---|---|---|---|
| **Lite single-threaded** (recommended) | `stockfish-18-lite-single.js` + `.wasm` | ~7MB | No CORS headers needed |
| Lite multi-threaded | `stockfish-18-lite.js` + `.wasm` | ~7MB | Requires CORS headers |
| Full single-threaded | `stockfish-18-single.js` + `.wasm` | ~113MB | Strongest, no CORS needed |
| Full multi-threaded | `stockfish-18.js` + `.wasm` | ~113MB | Strongest, requires CORS |
| ASM.js fallback | `stockfish-18-asm.js` | ~10MB | JavaScript only, slowest |

### 3. File Structure
```
web/
├── stockfish/
│   ├── stockfish.js                    # Loader stub (committed)
│   ├── stockfish-18-lite-single.js     # Engine (gitignored, downloaded)
│   └── stockfish-18-lite-single.wasm   # Engine (gitignored, downloaded)
└── js/
    └── stockfish_interop.js            # JS interop bridge (committed)
```

### 4. CORS Headers (multi-threaded builds only)
Multi-threaded builds require these response headers on your web server:
```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```
The lite single-threaded build does NOT need these.

## UCI Protocol

### Initialize
```
uci          -> responds with "uciok"
isready      -> responds with "readyok"
```

### Evaluate a Position
```
position fen <fen_string>
go depth 18
```

### Output Parsing
Engine outputs `info` lines during search:
```
info depth 18 seldepth 24 multipv 1 score cp 42 nodes 1234567 ... pv e2e4 e7e5
info depth 18 seldepth 22 multipv 2 score cp 28 nodes 1234567 ... pv d2d4
```

Key fields:
- `score cp <centipawns>` — evaluation in centipawns (positive = white advantage)
- `score mate <moves>` — forced mate in N moves
- `multipv <n>` — which line (1 = best, 2 = second best, etc.)
- `pv <moves>` — principal variation (best move sequence)

### Best Move
```
bestmove e2e4 ponder e7e5
```

### MultiPV Mode
To get top N moves:
```
setoption name MultiPV value 3
position fen <fen>
go depth 18
```
Returns `info` lines for multipv 1, 2, 3 at each depth.

## Blunder Detection Algorithm
1. Evaluate each position in the game at depth 18
2. Compare consecutive evaluations (from the moving side's perspective)
3. If eval drops by >= 100 centipawns, it's a blunder
4. For each blunder, use MultiPV to find all moves within 30cp of best
5. Store as `correct_moves` array

## Mate Score Handling
- Convert mate scores to large centipawn values: mate in N = 10000 - N
- This ensures mate-losing moves are properly detected as blunders
