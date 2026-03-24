#!/bin/bash
# PatternChess dev server
# Usage: ./dev.sh              - flutter run with hot reload (fast iteration)
#        ./dev.sh build        - full build + node serve (correct COEP, all engines work)

cd "$(dirname "$0")"

if [ "$1" = "build" ]; then
  echo "Building Flutter web (WASM)..."

  # Use web-server device (WASM-only, no JS fallback that fails with dartchess 64-bit ints)
  flutter run -d web-server --wasm --web-port=8090 &
  FLUTTER_PID=$!

  # Wait for build to complete (main.dart.wasm + flutter_bootstrap.js must both exist and be non-empty)
  echo -n "Compiling"
  while true; do
    if ! kill -0 $FLUTTER_PID 2>/dev/null; then
      echo ""
      echo "Error: Flutter build failed"
      exit 1
    fi
    if [ -s build/web/main.dart.wasm ] && [ -s build/web/flutter_bootstrap.js ]; then
      echo " done!"
      break
    fi
    echo -n "."
    sleep 2
  done

  # Kill flutter server — we'll serve with node instead
  kill $FLUTTER_PID 2>/dev/null
  wait $FLUTTER_PID 2>/dev/null

  # Copy engine + JS files into the build
  echo "Copying engine files..."
  cp web/stockfish/* build/web/stockfish/
  cp web/js/* build/web/js/

  echo "Starting server at http://localhost:8080"
  node serve.js
else
  flutter run -d chrome --wasm \
    --web-header=Cross-Origin-Embedder-Policy=require-corp \
    --web-header=Cross-Origin-Opener-Policy=same-origin
fi
