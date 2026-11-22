#!/bin/bash
# The email Worker on :8791 against the same local D1 as scripts/dev-api.sh
# (same STATE). DEV_MAILBOX keeps emails in memory instead of sending them:
# open http://localhost:8791/dev/mailbox to read them and to run the hourly
# job for one account. Links in the emails point at the local app (:5173).
set -euo pipefail
cd "$(dirname "$0")/.."
STATE=${STATE:-.wrangler/state}
exec npx wrangler dev --config workers/notifier/wrangler.jsonc --local --port 8791 --persist-to "$STATE" \
  --var SEND_MODE:test --var DEV_MAILBOX:1 \
  --var APP_URL:http://localhost:5173 --var EMAIL_URL:http://localhost:8791
