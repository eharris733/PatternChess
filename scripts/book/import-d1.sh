#!/usr/bin/env bash
# Imports the emitted opening book (data/book/d1/*.sql from
# `book-builder emit`) into the Cloudflare D1 database bound as BOOK on the
# `patternchess` Pages project. Loads into book_positions_next, then swaps it
# in, so the live table is never half-filled.
#
#   scripts/book/import-d1.sh [--local] [--first]
#
#   --local   import into wrangler's local D1 (for `wrangler pages dev`)
#   --first   first import ever: there is no book_positions to swap out yet
#   --resume-from N   skip schema.sql and data chunks before data-N.sql (after a
#                     failed run; the staged book_positions_next is kept)
#
# wrangler runs from $HOME: inside the repo it picks up a stale
# CLOUDFLARE_API_TOKEN from .env.local.
set -euo pipefail
DB=patternchess-book
repo="$(cd "$(dirname "$0")/../.." && pwd)"
dir="$repo/data/book/d1"
target=--remote
swap=swap.sql
resume=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --local) target=--local ;;
    --first) swap=swap-first.sql ;;
    --resume-from) resume=$((10#$2)); shift ;;
    *) echo "unknown option $1" >&2; exit 1 ;;
  esac
  shift
done
[[ -f $dir/schema.sql ]] || { echo "run book-builder emit first ($dir/schema.sql missing)" >&2; exit 1; }

run() {
  echo "→ $(basename "$1")"
  # D1 imports upload through a presigned URL that occasionally drops; retry.
  for attempt in 1 2 3 4 5 6; do
    if (cd "$HOME" && npx --prefix "$repo" wrangler d1 execute "$DB" "$target" --yes --file "$1" >/dev/null); then
      return
    fi
    echo "  retrying ($attempt)…"
    sleep 20
  done
  echo "  giving up on $(basename "$1")" >&2
  exit 1
}

(( resume > 0 )) || run "$dir/schema.sql"
for f in "$dir"/data-*.sql; do
  n=$(basename "$f" .sql); n=$((10#${n#data-}))
  (( n < resume )) && continue
  run "$f"
done
run "$dir/$swap"
(cd "$HOME" && npx --prefix "$repo" wrangler d1 execute "$DB" "$target" --command "SELECT tier, count(*) AS rows FROM book_positions GROUP BY tier; SELECT * FROM book_meta;")
