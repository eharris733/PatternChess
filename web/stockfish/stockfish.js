// This file is no longer used as the entry point.
// The web worker now loads stockfish-18-lite-single.js directly.
// See web/js/stockfish_interop.js for the worker setup.
//
// To set up Stockfish 18:
//   npm pack stockfish@18.0.5
//   tar -xzf stockfish-18.0.5.tgz
//   cp package/bin/stockfish-18-lite-single.js web/stockfish/
//   cp package/bin/stockfish-18-lite-single.wasm web/stockfish/stockfish.wasm
//   rm -rf package stockfish-18.0.5.tgz
//
// The WASM must be named stockfish.wasm (the engine JS hardcodes this name).
// Source: https://github.com/nmrugg/stockfish.js
