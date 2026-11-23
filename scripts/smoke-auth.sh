#!/bin/bash
# E2E smoke for better-auth + RPC (AUTH_TEST_MODE=1): sign up, get-session, rpc me,
# sign out, sign in. Usage: scripts/smoke-auth.sh [base-url]  (default http://localhost:8788;
# pass http://localhost:5173 to go through the Vite proxy, or a preview URL).
B=${1:-http://localhost:8788}; J=$(mktemp); EMAIL="smoke$(date +%s)@test.dev"
post() { curl -s -b $J -c $J -X POST "$B$1" -H 'Content-Type: application/json' -H "Origin: $B" -d "$2"; }
echo "== health";      post /api/rpc/health '{}'; echo
echo "== me signed out"; post /api/rpc/me '{}'; echo
echo "== sign-up";     post /api/auth/sign-up/email "{\"email\":\"$EMAIL\",\"password\":\"correct-horse-9\",\"name\":\"Smoke Test\"}" | cut -c1-300; echo
echo "== cookies";     grep -o 'better-auth[^	]*' $J | cut -c1-60
echo "== get-session"; curl -s -b $J "$B/api/auth/get-session" | cut -c1-300; echo
echo "== me";          post /api/rpc/me '{}'; echo
echo "== health in";   post /api/rpc/health '{}'; echo
echo "== sign-out";    post /api/auth/sign-out '{}'; echo
echo "== get-session"; curl -s -b $J "$B/api/auth/get-session"; echo
echo "== me after";    post /api/rpc/me '{}'; echo
echo "== sign-in";     post /api/auth/sign-in/email "{\"email\":\"$EMAIL\",\"password\":\"correct-horse-9\"}" | cut -c1-200; echo
echo "== me again";    post /api/rpc/me '{}'; echo
echo "EMAIL=$EMAIL"
rm -f $J
