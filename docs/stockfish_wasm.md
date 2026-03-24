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
cp package/bin/stockfish-18.js web/stockfish/
cp package/bin/stockfish-18.wasm web/stockfish/stockfish.wasm
rm -rf package stockfish-18.0.5.tgz
```

Source: [nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js) (npm package: `stockfish`)

### 2. Current Build: Full Multi-threaded

Using `stockfish-18.js` + `stockfish.wasm` (~113MB). Full NNUE neural net, strongest analysis. Cached by browser after first load. Uses Lazy SMP with up to 4 threads (auto-detected from `navigator.hardwareConcurrency`).

### 3. File Structure
```
web/
├── stockfish/
│   ├── stockfish.js                    # Loader stub (committed, unused)
│   ├── stockfish-18.js                 # Multi-threaded engine loader (gitignored)
│   └── stockfish.wasm                  # Engine binary (gitignored, ~113MB)
└── js/
    └── stockfish_interop.js            # JS interop bridge (committed)
```

### 4. CORS Headers (required)
Multi-threaded WASM requires these response headers for `SharedArrayBuffer`:
```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

Dev server (`--wasm` required for `dartchess` 64-bit bitboards):
```bash
flutter run -d chrome --wasm --web-header=Cross-Origin-Embedder-Policy=require-corp --web-header=Cross-Origin-Opener-Policy=same-origin
```

Production: configure headers on your hosting platform.

### 5. Search Strategy
- **Batch analysis** (`analyzeGame`): `go depth 12` — fast and consistent
- **On-the-fly eval** (`evaluateMove`): `go movetime 500` — 0.5s time limit, threads collaborate for best result

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
