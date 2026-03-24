// Stockfish WASM interop for Dart
// Uses nmrugg/stockfish.js Lite (7MB WASM, NNUE embedded)
// Primary: multi-threaded (requires CORS), Fallback: single-threaded
let sfWorker = null;
let outputLines = [];
let resolveWaiting = null;

const ENGINE_MT = 'stockfish/stockfish-18-lite.js';
const ENGINE_ST = 'stockfish/stockfish-18-lite-single.js';

function tryLoadWorker(path) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Load timeout'));
    }, 30000);

    const worker = new Worker(path);

    worker.onmessage = function(e) {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      if (line.includes('uciok')) {
        clearTimeout(timeout);
        resolve(worker);
      }
    };

    worker.onerror = function(e) {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(e.message || 'Worker load error'));
    };

    worker.postMessage('uci');
  });
}

async function initStockfish() {
  try {
    // Try multi-threaded first (faster, requires CORS/SharedArrayBuffer)
    try {
      sfWorker = await tryLoadWorker(ENGINE_MT);
      console.log('Stockfish Lite MT ready (nmrugg/stockfish.js, multi-threaded)');
    } catch (e) {
      console.warn('Stockfish Lite MT failed, falling back to single-threaded:', e.message);
      sfWorker = await tryLoadWorker(ENGINE_ST);
      console.log('Stockfish Lite ST ready (nmrugg/stockfish.js, single-threaded fallback)');
    }

    // Set up persistent message handler
    sfWorker.onmessage = function(e) {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      outputLines.push(line);

      if (resolveWaiting) {
        if (line.startsWith('bestmove') || line === 'uciok' || line === 'readyok') {
          const callback = resolveWaiting;
          resolveWaiting = null;
          callback(outputLines.join('\n'));
          outputLines = [];
        }
      }
    };

    sfWorker.onerror = function(e) {
      console.error('Stockfish worker error:', e.message);
    };

    // Wait for isready/readyok
    return new Promise((resolve) => {
      sfWorker.postMessage('isready');
      resolveWaiting = function(output) {
        resolve(output.includes('readyok'));
      };
    });
  } catch (e) {
    console.error('Failed to init Stockfish:', e);
    return false;
  }
}

function sendStockfishCommand(command) {
  if (sfWorker) {
    sfWorker.postMessage(command);
  }
}

function waitForBestMove() {
  return new Promise((resolve) => {
    outputLines = [];
    resolveWaiting = resolve;
  });
}

function waitForAnalysis(timeOrDepth) {
  return new Promise((resolve) => {
    outputLines = [];
    resolveWaiting = function(output) {
      resolve(output);
    };
  });
}

// Expose to globalThis for Dart JS interop
globalThis.initStockfish = initStockfish;
globalThis.sendStockfishCommand = sendStockfishCommand;
globalThis.waitForBestMove = waitForBestMove;
globalThis.waitForAnalysis = waitForAnalysis;
