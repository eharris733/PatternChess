# Stockfish Engine Benchmark Results

Benchmark run on 2026-03-22. All engines tested via the `/benchmark` screen.
Position: startpos, depth 15, single run per engine.

## Important: Serving Requirements

The Flutter dev server's `--web-header` flag **appends** COEP headers rather than replacing the default `credentialless`. This causes duplicate COEP values (`credentialless, require-corp`) which Chrome treats as invalid, blocking all Worker and pthread loads.

**Solution:** Use `serve.js` (Node.js) for benchmarking and testing:
```bash
flutter build web --wasm   # may fail on JS fallback, but WASM artifacts are built
cp web/stockfish/* build/web/stockfish/
node serve.js              # serves at http://localhost:8080 with correct COEP
```

For normal development, `flutter run -d chrome --wasm` with COEP headers still works for the lichess ES module engines (they use `import()` not Workers), but nmrugg Worker-based engines will fail.

## Results Summary

| Engine | Source | Load Time | Analysis (d15) | NPS | Size | CORS |
|--------|--------|-----------|----------------|-----|------|------|
| **Lite ST** | nmrugg | **620ms** | **359ms** | **308K** | ~7MB | No |
| **Lite MT** | nmrugg | 811ms | 425ms | 301K | ~7MB | Yes |
| SF18 SmallNet | lichess | 514ms | 1.26s | 198K | ~574KB | Yes |
| Fairy SF14 | lichess | 381ms | 2.07s | 274K | ~804KB | Yes |
| Full MT | nmrugg | 3.11s | 497ms | 144K | ~108MB | Yes |
| Full ST | nmrugg | 3.19s | 548ms | 119K | ~108MB | No |
| SF Dev +NNUE | lichess | 2.15s | 1.32s | 87K | ~596KB+NNUE | Yes |
| SF18 +NNUE | lichess | 3.91s | 940ms | 74K | ~580KB+107MB NNUE | Yes |
| ASM.js | nmrugg | 2.08s | 3.77s | 29K | ~10MB | No |

## 20-Game Simulation (depth 12, ~800 positions)

Simulates analyzing 20 full games at depth 12 (~40 positions per game = 800 positions).
Measured by analyzing 10 representative middlegame positions and extrapolating.

| Engine | Avg/Position | Est. 20 Games | Init Time |
|--------|-------------|---------------|-----------|
| **Lite MT** (nmrugg) | **71ms** | **57.7s** | 719ms |
| **Lite ST** (nmrugg) | 80ms | 1.1m | 540ms |
| Full MT (nmrugg) | 172ms | 2.3m | 2.07s |
| Full ST (nmrugg) | 184ms | 2.5m | 2.82s |
| SF18 SmallNet (lichess) | 193ms | 2.6m | 437ms |
| SF Dev +NNUE (lichess) | 283ms | 3.8m | 1.86s |
| SF18 +NNUE (lichess) | 293ms | 3.9m | 2.20s |
| Fairy SF14 (lichess) | 521ms | 7.0m | 476ms |
| ASM.js (nmrugg) | 652ms | 8.7m | 1.85s |

**Key takeaway:** The nmrugg Lite MT engine can analyze 20 games in under a minute — nearly **4x faster** than the current lichess SF18+NNUE (3.9 minutes). Init time is negligible compared to analysis time at scale.

## Key Observations

### Speed Champion: nmrugg Lite (Single-threaded)
- **Fastest analysis:** 359ms to depth 15
- **Highest NPS:** 308K nodes/second
- **Fast load:** 620ms (7MB WASM)
- **No CORS required** - works without SharedArrayBuffer headers
- Lite NNUE is embedded in the WASM binary (~7MB total)

### Best Accuracy: nmrugg Full (Multi-threaded) or lichess SF18 +NNUE
- The full-size engines use larger NNUE nets for stronger play
- nmrugg Full has NNUE embedded in the 108MB WASM
- lichess SF18 loads NNUE separately (107MB total)
- Both are slower to load but produce stronger evaluations

### Fastest Load: Fairy Stockfish 14 (lichess)
- Loads in 381ms (804KB WASM, no NNUE)
- 274K NPS but it's a variant chess engine, not standard Stockfish

### Avoid: ASM.js
- 10x slower than any WASM variant (29K vs 300K+ NPS)
- Only useful as universal fallback for browsers without WASM

## Loading Patterns

### nmrugg/stockfish.js (Web Worker)
```javascript
const worker = new Worker('stockfish/stockfish-18-lite-single.js');
worker.onmessage = (e) => { /* e.data is a UCI output line */ };
worker.postMessage('uci');          // send UCI commands
worker.postMessage('go depth 15');  // start analysis
```
- All variants reference `stockfish.wasm` internally — the WASM file must match the variant
- NNUE is embedded in the WASM binary
- Multi-threaded variants require CORS isolation headers

### @lichess-org/stockfish-web (ES Module)
```javascript
const { default: Factory } = await import('stockfish/sf_18.js');
const module = await Factory();
module.listen = (line) => { /* UCI output line */ };
module.uci('uci');           // send UCI commands
module.uci('go depth 15');   // start analysis
// NNUE must be loaded separately for sf_18 and sf_dev
module.setNnueBuffer(nnueData, 0);  // big net
module.setNnueBuffer(nnueData, 1);  // small net
```
- All variants use pthreads, requiring CORS isolation
- `sf_18_smallnet` has a small net embedded, no external NNUE needed

## Recommendation

For this app's use case (analyzing chess positions for blunder detection):

1. **Primary engine: nmrugg Lite Single-threaded** — fastest load, fastest analysis, no CORS dependency, 7MB total. Strong enough for blunder detection (Elo ~3000).

2. **High-accuracy option: lichess SF18 +NNUE** — strongest evaluations with full NNUE, but 107MB download and requires CORS. Use when accuracy matters more than speed.

3. **Current engine (lichess SF18)** remains a good choice when CORS is available and NNUE files are cached.
