#!/bin/bash
# Local Pages Functions (better-auth at /api/auth, RPC at /api/rpc) on :8788
# with the app D1 (DB), the auth KV (AUTH_KV) and the content KV (CONTENT:
# supporter course days via `npm run courses:sync -- --local`; articles: seed with
# `wrangler kv key put article:<slug> … --namespace-id $CONTENT_ID --local
# --persist-to .wrangler/state`), persisted under .wrangler/state.
# Pair it with `npm run dev`: Vite proxies /api/auth, /api/rpc, /api/stripe and /api/articles here.
# Secrets come from .dev.vars (BETTER_AUTH_SECRET, BETTER_AUTH_URL=http://localhost:8788,
# AUTH_TEST_MODE=1 for the email+password test sign-in).
set -euo pipefail
cd "$(dirname "$0")/.."
STATE=.wrangler/state
DB_ID=7d359ac5-7829-4a4d-8fa9-5af6379cdf15 # patternchess-app
CONTENT_ID=d4683ee908184d24a880ed39b4ebedaf # patternchess-content (local copy keyed by the real id)

# Idempotent: applies only migrations the local DB hasn't seen.
npx wrangler d1 migrations apply patternchess-app --local --config d1/wrangler.jsonc --persist-to "$STATE"

# Pages dev serves dist/ too; an empty dir is enough when Vite serves the SPA.
mkdir -p dist
exec npx wrangler pages dev dist --port 8788 \
  --compatibility-date=2026-06-18 --compatibility-flags=nodejs_compat \
  --d1 "DB=$DB_ID" --kv AUTH_KV --kv "CONTENT=$CONTENT_ID" --persist-to "$STATE"
