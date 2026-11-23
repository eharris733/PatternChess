#!/bin/bash
# Local Pages Functions (better-auth at /api/auth, RPC at /api/rpc) on :8788
# with the app D1 (DB), the auth KV (AUTH_KV) and the articles KV (CONTENT, empty
# locally: seed with `wrangler kv key put article:<slug> … --namespace-id CONTENT --local
# --persist-to .wrangler/state`), persisted under .wrangler/state.
# Pair it with `npm run dev`: Vite proxies /api/auth, /api/rpc, /api/stripe and /api/articles here.
# Secrets come from .dev.vars (BETTER_AUTH_SECRET, BETTER_AUTH_URL=http://localhost:8788,
# AUTH_TEST_MODE=1 for the email+password test sign-in).
# Parallel instances: PC_API_PORT (default 8788) picks the port (pair with
# `PC_API_PORT=<same> PORT=<vite port> npm run dev`) and PC_PERSIST_DIR
# (default .wrangler/state) the local D1/KV store.
set -euo pipefail
cd "$(dirname "$0")/.."
STATE="${PC_PERSIST_DIR:-.wrangler/state}"
API_PORT="${PC_API_PORT:-8788}"
DB_ID=7d359ac5-7829-4a4d-8fa9-5af6379cdf15 # patternchess-app

# Idempotent: applies only migrations the local DB hasn't seen.
npx wrangler d1 migrations apply patternchess-app --local --config d1/wrangler.jsonc --persist-to "$STATE"

# Pages dev serves dist/ too; an empty dir is enough when Vite serves the SPA.
mkdir -p dist
exec npx wrangler pages dev dist --port "$API_PORT" \
  --compatibility-date=2026-06-18 --compatibility-flags=nodejs_compat \
  --d1 "DB=$DB_ID" --kv AUTH_KV --kv CONTENT --persist-to "$STATE"
