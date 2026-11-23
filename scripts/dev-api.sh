#!/bin/bash
# Local Pages Functions (better-auth at /api/auth, RPC at /api/rpc) on :8788
# with the app D1 (DB), the auth KV (AUTH_KV) and the content KV (CONTENT:
# supporter course days via `npm run courses:sync -- --local`; articles: seed with
# `wrangler kv key put article:<slug> … --namespace-id $CONTENT_ID --local
# --persist-to .wrangler/state`), persisted under .wrangler/state.
# Pair it with `npm run dev`: Vite proxies /api/auth, /api/rpc, /api/stripe and /api/articles here.
# Secrets come from .dev.vars (BETTER_AUTH_SECRET, BETTER_AUTH_URL=http://localhost:8788,
# AUTH_TEST_MODE=1 for the email+password test sign-in).
# Parallel instances: PC_API_PORT (default 8788) picks the port (pair with
# `PC_API_PORT=<same> PORT=<vite port> npm run dev`) and PC_PERSIST_DIR
# (default .wrangler/state) the local D1/KV store.
set -euo pipefail
cd "$(dirname "$0")/.."
# STATE=<dir> (or PC_PERSIST_DIR) picks another local store (e.g. a second copy of the production data).
STATE="${PC_PERSIST_DIR:-${STATE:-.wrangler/state}}"
API_PORT="${PC_API_PORT:-8788}"
DB_ID=7d359ac5-7829-4a4d-8fa9-5af6379cdf15 # patternchess-app
CONTENT_ID=d4683ee908184d24a880ed39b4ebedaf # patternchess-content (local copy keyed by the real id)

# Idempotent: applies only migrations the local DB hasn't seen.
npx wrangler d1 migrations apply patternchess-app --local --config d1/wrangler.jsonc --persist-to "$STATE"

# Courses waiting on creator permission: `npm run dev` shows them, so the
# courses RPCs here accept them too (VITE_SHOW_PENDING_COURSES=0 to mimic production).
SHOW_PENDING="${VITE_SHOW_PENDING_COURSES:-1}"

# NOTIFIER: the email Worker's RPC (sendConfirm), reached through wrangler's
# dev registry when scripts/dev-notifier.sh is running; without it the call
# fails quietly and only the hourly job would send the confirmation.
# Pages dev serves dist/ too; an empty dir is enough when Vite serves the SPA.
mkdir -p dist
exec npx wrangler pages dev dist --port "$API_PORT" \
  --compatibility-date=2026-06-18 --compatibility-flags=nodejs_compat \
  --d1 "DB=$DB_ID" --kv AUTH_KV --kv "CONTENT=$CONTENT_ID" --persist-to "$STATE" \
  --binding "VITE_SHOW_PENDING_COURSES=$SHOW_PENDING" \
  --service NOTIFIER=patternchess-notifier
