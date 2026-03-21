// Stockfish WASM Web Worker interop for Dart
let stockfishWorker = null;
let outputLines = [];
let resolveWaiting = null;

function initStockfish() {
  return new Promise((resolve) => {
    try {
      stockfishWorker = new Worker('stockfish/stockfish-18-lite-single.js');

      stockfishWorker.onmessage = function(event) {
        const line = typeof event.data === 'string' ? event.data : event.data.toString();
        outputLines.push(line);

        // Check if we're waiting for a response
        if (resolveWaiting) {
          if (line.startsWith('bestmove') || line === 'uciok' || line === 'readyok') {
            const callback = resolveWaiting;
            resolveWaiting = null;
            callback(outputLines.join('\n'));
            outputLines = [];
          }
        }
      };

      stockfishWorker.onerror = function(error) {
        console.error('Stockfish worker error:', error);
        if (resolveWaiting) {
          resolveWaiting('error: ' + error.message);
          resolveWaiting = null;
        }
      };

      // Initialize UCI
      stockfishWorker.postMessage('uci');

      // Wait for uciok
      resolveWaiting = function(output) {
        if (output.includes('uciok')) {
          stockfishWorker.postMessage('isready');
          resolveWaiting = function(readyOutput) {
            resolve(true);
          };
        } else {
          resolve(false);
        }
      };
    } catch (e) {
      console.error('Failed to init Stockfish:', e);
      resolve(false);
    }
  });
}

function sendStockfishCommand(command) {
  if (stockfishWorker) {
    stockfishWorker.postMessage(command);
  }
}

function waitForBestMove() {
  return new Promise((resolve) => {
    outputLines = [];
    resolveWaiting = resolve;
  });
}

function waitForAnalysis(depth) {
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
