// Stockfish Benchmark - loads and benchmarks all available engine variants
// Supports both nmrugg/stockfish.js (Web Worker) and @lichess-org/stockfish-web (ES Module)

const ENGINE_VARIANTS = [
  // nmrugg/stockfish.js variants (Web Worker pattern)
  {
    id: 'nmrugg-full-mt',
    name: 'Stockfish 18 Full (Multi-threaded)',
    source: 'nmrugg/stockfish.js',
    type: 'worker',
    jsFile: 'stockfish-18.js',
    sizeLabel: '~108MB WASM',
    requiresCORS: true,
  },
  {
    id: 'nmrugg-full-st',
    name: 'Stockfish 18 Full (Single-threaded)',
    source: 'nmrugg/stockfish.js',
    type: 'worker',
    jsFile: 'stockfish-18-single.js',
    sizeLabel: '~108MB WASM',
    requiresCORS: false,
  },
  {
    id: 'nmrugg-lite-mt',
    name: 'Stockfish 18 Lite (Multi-threaded)',
    source: 'nmrugg/stockfish.js',
    type: 'worker',
    jsFile: 'stockfish-18-lite.js',
    sizeLabel: '~7MB WASM',
    requiresCORS: true,
  },
  {
    id: 'nmrugg-lite-st',
    name: 'Stockfish 18 Lite (Single-threaded)',
    source: 'nmrugg/stockfish.js',
    type: 'worker',
    jsFile: 'stockfish-18-lite-single.js',
    sizeLabel: '~7MB WASM',
    requiresCORS: false,
  },
  {
    id: 'nmrugg-asm',
    name: 'Stockfish 18 ASM.js (No WASM)',
    source: 'nmrugg/stockfish.js',
    type: 'worker',
    jsFile: 'stockfish-18-asm.js',
    sizeLabel: '~10MB JS',
    requiresCORS: false,
  },
  // @lichess-org/stockfish-web variants (ES Module pattern)
  {
    id: 'lichess-sf18',
    name: 'Stockfish 18 (lichess + NNUE)',
    source: '@lichess-org/stockfish-web',
    type: 'esmodule',
    jsFile: 'sf_18.js',
    sizeLabel: '~580KB WASM + 107MB NNUE',
    requiresCORS: true,
    needsNNUE: true,
  },
  {
    id: 'lichess-sf18-smallnet',
    name: 'Stockfish 18 SmallNet (lichess)',
    source: '@lichess-org/stockfish-web',
    type: 'esmodule',
    jsFile: 'sf_18_smallnet.js',
    sizeLabel: '~574KB WASM',
    requiresCORS: true,
    needsNNUE: false,
  },
  {
    id: 'lichess-sfdev',
    name: 'Stockfish Dev (lichess + NNUE)',
    source: '@lichess-org/stockfish-web',
    type: 'esmodule',
    jsFile: 'sf_dev.js',
    sizeLabel: '~596KB WASM + NNUE',
    requiresCORS: true,
    needsNNUE: true,
  },
  {
    id: 'lichess-fsf14',
    name: 'Fairy Stockfish 14 (lichess)',
    source: '@lichess-org/stockfish-web',
    type: 'esmodule',
    jsFile: 'fsf_14.js',
    sizeLabel: '~804KB WASM',
    requiresCORS: true,
    needsNNUE: false,
  },
];

// Active workers/modules for cleanup
const activeEngines = {};

async function loadWorkerEngine(variant) {
  const start = performance.now();
  const worker = new Worker('stockfish/' + variant.jsFile);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Load timeout (60s)'));
    }, 60000);

    worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      if (line.includes('uciok')) {
        clearTimeout(timeout);
        resolve({ worker, loadTimeMs: performance.now() - start, type: 'worker' });
      }
    };

    worker.onerror = (e) => {
      clearTimeout(timeout);
      reject(new Error(e.message || 'Worker load error'));
    };

    worker.postMessage('uci');
  });
}

async function loadESModuleEngine(variant) {
  const start = performance.now();
  const { default: Factory } = await import('../stockfish/' + variant.jsFile);
  const module = await Factory();

  if (variant.needsNNUE) {
    try {
      const bigName = module.getRecommendedNnue(0);
      const smallName = module.getRecommendedNnue(1);
      console.log(`[${variant.id}] Loading NNUE: ${bigName}, ${smallName}`);

      const [bigData, smallData] = await Promise.all([
        fetch('stockfish/' + bigName).then(r => r.arrayBuffer()).then(b => new Uint8Array(b)),
        fetch('stockfish/' + smallName).then(r => r.arrayBuffer()).then(b => new Uint8Array(b)),
      ]);

      module.setNnueBuffer(bigData, 0);
      module.setNnueBuffer(smallData, 1);
    } catch (e) {
      console.warn(`[${variant.id}] NNUE loading failed:`, e);
    }
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('UCI init timeout (60s)')), 60000);

    module.listen = (line) => {
      if (line === 'uciok') {
        clearTimeout(timeout);
        resolve({ module, loadTimeMs: performance.now() - start, type: 'esmodule' });
      }
    };
    module.onError = (msg) => {
      clearTimeout(timeout);
      reject(new Error(msg));
    };
    module.uci('uci');
  });
}

function runAnalysisBenchmark(engine, loadResult) {
  const send = loadResult.type === 'worker'
    ? (cmd) => loadResult.worker.postMessage(cmd)
    : (cmd) => loadResult.module.uci(cmd);

  const listen = loadResult.type === 'worker'
    ? (callback) => { loadResult.worker.onmessage = (e) => callback(typeof e.data === 'string' ? e.data : String(e.data)); }
    : (callback) => { loadResult.module.listen = callback; };

  return new Promise((resolve) => {
    let analysisStart = null;
    let lastNps = 0;
    let reachedDepth = 0;
    let bestMove = '';

    listen((line) => {
      if (line === 'readyok') {
        send('ucinewgame');
        send('position startpos');
        analysisStart = performance.now();
        send('go depth 15');
        return;
      }

      if (line.startsWith('info') && line.includes(' nps ')) {
        const npsMatch = line.match(/nps (\d+)/);
        if (npsMatch) lastNps = parseInt(npsMatch[1]);
        const depthMatch = line.match(/\bdepth (\d+)/);
        if (depthMatch) reachedDepth = Math.max(reachedDepth, parseInt(depthMatch[1]));
      }

      if (line.startsWith('bestmove')) {
        bestMove = line.split(' ')[1] || '';
        const analysisTimeMs = analysisStart ? performance.now() - analysisStart : 0;
        resolve({
          analysisTimeMs: Math.round(analysisTimeMs),
          nodesPerSecond: lastNps,
          depth: reachedDepth,
          bestMove,
        });
      }
    });

    send('isready');
  });
}

function cleanupEngine(engineId) {
  const active = activeEngines[engineId];
  if (!active) return;

  try {
    if (active.type === 'worker') {
      active.worker.postMessage('quit');
      active.worker.terminate();
    }
  } catch (e) {
    // ignore cleanup errors
  }
  delete activeEngines[engineId];
}

globalThis.getBenchmarkEngines = () => JSON.stringify(ENGINE_VARIANTS);

globalThis.runEngineBenchmark = async (engineId) => {
  const variant = ENGINE_VARIANTS.find(v => v.id === engineId);
  if (!variant) return JSON.stringify({ error: 'Unknown engine: ' + engineId });

  // Clean up any previous run of this engine
  cleanupEngine(engineId);

  try {
    console.log(`[${engineId}] Loading...`);
    const loadResult = variant.type === 'worker'
      ? await loadWorkerEngine(variant)
      : await loadESModuleEngine(variant);

    activeEngines[engineId] = loadResult;
    console.log(`[${engineId}] Loaded in ${Math.round(loadResult.loadTimeMs)}ms, running benchmark...`);

    const benchResult = await runAnalysisBenchmark(variant, loadResult);
    console.log(`[${engineId}] Benchmark done: depth=${benchResult.depth}, nps=${benchResult.nodesPerSecond}, time=${benchResult.analysisTimeMs}ms`);

    cleanupEngine(engineId);

    return JSON.stringify({
      loadTimeMs: Math.round(loadResult.loadTimeMs),
      analysisTimeMs: benchResult.analysisTimeMs,
      nodesPerSecond: benchResult.nodesPerSecond,
      depth: benchResult.depth,
      bestMove: benchResult.bestMove,
      error: null,
    });
  } catch (e) {
    console.error(`[${engineId}] Error:`, e);
    cleanupEngine(engineId);
    return JSON.stringify({
      loadTimeMs: 0,
      analysisTimeMs: 0,
      nodesPerSecond: 0,
      depth: 0,
      bestMove: '',
      error: e.message || String(e),
    });
  }
};

globalThis.cancelBenchmark = (engineId) => {
  cleanupEngine(engineId);
};

// --- Deep Analysis Benchmark ---
// Simulates analyzing 20 games by running 10 representative positions at depth 12,
// then extrapolating to 800 positions (20 games × ~40 moves each).

const BENCHMARK_POSITIONS = [
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
  'rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2',
  'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
  'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
  'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 5',
  'r2qkb1r/ppp2ppp/2np1n2/4p1B1/2B1P3/5N2/PPP2PPP/RN1QK2R w KQkq - 0 6',
  'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 b - - 0 7',
  '2rq1rk1/pp1bppbp/2np1np1/8/2BNP3/2N1BP2/PPPQ2PP/R4RK1 b - - 5 10',
  'r4rk1/1ppqbppp/p1np1n2/4p1B1/4P3/2NP1N1P/PPP2PP1/R2QR1K1 b - - 0 10',
  'r1b2rk1/2q1bppp/p2p1n2/np2p3/3PP3/2N2N1P/PPB2PP1/R1BQR1K1 w - - 0 13',
];

const POSITIONS_PER_GAME = 40;
const GAMES_TO_SIMULATE = 50;
const TOTAL_POSITIONS = POSITIONS_PER_GAME * GAMES_TO_SIMULATE; // 2000

function runPositionAnalysis(loadResult, fen, depth) {
  const send = loadResult.type === 'worker'
    ? (cmd) => loadResult.worker.postMessage(cmd)
    : (cmd) => loadResult.module.uci(cmd);

  const listen = loadResult.type === 'worker'
    ? (callback) => { loadResult.worker.onmessage = (e) => callback(typeof e.data === 'string' ? e.data : String(e.data)); }
    : (callback) => { loadResult.module.listen = callback; };

  return new Promise((resolve) => {
    let analysisStart = null;
    let scoreCp = 0;

    listen((line) => {
      if (line === 'readyok') {
        send('position fen ' + fen);
        analysisStart = performance.now();
        send('go depth ' + depth);
        return;
      }
      if (line.startsWith('info') && line.includes('score cp ')) {
        const m = line.match(/score cp (-?\d+)/);
        if (m) scoreCp = parseInt(m[1]);
      }
      if (line.startsWith('bestmove')) {
        resolve({
          timeMs: Math.round(performance.now() - analysisStart),
          scoreCp,
          bestMove: line.split(' ')[1] || '',
        });
      }
    });

    send('isready');
  });
}

globalThis.runDeepBenchmark = async (engineId) => {
  const variant = ENGINE_VARIANTS.find(v => v.id === engineId);
  if (!variant) return JSON.stringify({ error: 'Unknown engine: ' + engineId });

  cleanupEngine(engineId);

  try {
    console.log(`[${engineId}] Deep benchmark: loading...`);
    const initStart = performance.now();
    const loadResult = variant.type === 'worker'
      ? await loadWorkerEngine(variant)
      : await loadESModuleEngine(variant);

    activeEngines[engineId] = loadResult;
    const loadTimeMs = Math.round(loadResult.loadTimeMs);

    const send = loadResult.type === 'worker'
      ? (cmd) => loadResult.worker.postMessage(cmd)
      : (cmd) => loadResult.module.uci(cmd);

    // Wait for engine to be ready
    await new Promise((resolve) => {
      const listen = loadResult.type === 'worker'
        ? (cb) => { loadResult.worker.onmessage = (e) => cb(typeof e.data === 'string' ? e.data : String(e.data)); }
        : (cb) => { loadResult.module.listen = cb; };
      listen((line) => { if (line === 'readyok') resolve(); });
      send('ucinewgame');
      send('isready');
    });

    console.log(`[${engineId}] Deep benchmark: analyzing ${BENCHMARK_POSITIONS.length} positions at depth 12...`);

    const positionTimes = [];
    const evalScores = [];
    for (let i = 0; i < BENCHMARK_POSITIONS.length; i++) {
      const result = await runPositionAnalysis(loadResult, BENCHMARK_POSITIONS[i], 12);
      positionTimes.push(result.timeMs);
      evalScores.push(result.scoreCp);
      if ((i + 1) % 5 === 0) {
        console.log(`[${engineId}] Deep benchmark: ${i + 1}/${BENCHMARK_POSITIONS.length} positions done`);
      }
    }

    const totalAnalysisMs = positionTimes.reduce((a, b) => a + b, 0);
    const avgPerPosition = totalAnalysisMs / positionTimes.length;
    const estimatedTotal = Math.round(loadTimeMs + (avgPerPosition * TOTAL_POSITIONS));
    const totalElapsed = Math.round(performance.now() - initStart);

    console.log(`[${engineId}] Deep benchmark done: avg=${Math.round(avgPerPosition)}ms/pos, estimated 50-game total=${estimatedTotal}ms, evals=[${evalScores.join(',')}]`);

    cleanupEngine(engineId);

    return JSON.stringify({
      loadTimeMs,
      positionsAnalyzed: BENCHMARK_POSITIONS.length,
      totalAnalysisMs: Math.round(totalAnalysisMs),
      avgPerPositionMs: Math.round(avgPerPosition),
      estimatedTotalMs: estimatedTotal,
      actualElapsedMs: totalElapsed,
      evalScores,
      error: null,
    });
  } catch (e) {
    console.error(`[${engineId}] Deep benchmark error:`, e);
    cleanupEngine(engineId);
    return JSON.stringify({
      loadTimeMs: 0,
      positionsAnalyzed: 0,
      totalAnalysisMs: 0,
      avgPerPositionMs: 0,
      estimatedTotalMs: 0,
      actualElapsedMs: 0,
      error: e.message || String(e),
    });
  }
};

console.log('Stockfish Benchmark loaded. ' + ENGINE_VARIANTS.length + ' engine variants available.');
