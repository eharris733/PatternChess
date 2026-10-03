#!/usr/bin/env bash
# Downloads the raw inputs for the self-hosted opening book into data/book/raw
# (gitignored). Re-running skips files already present.
#
#   scripts/book/download.sh broadcasts          # every monthly broadcast file
#   scripts/book/download.sh elite 2023-01 2025-11   # Lichess Elite months, inclusive
#   scripts/book/download.sh evals               # Lichess eval DB (~20 GB)
#
# Sources and licences:
#   broadcasts  https://database.lichess.org/#broadcasts   CC BY-SA 4.0
#   elite       https://database.nikonoel.fr/              (licence unstated — ask before shipping)
#   evals       https://database.lichess.org/#evals        CC0
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p data/book/raw
cd data/book/raw

fetch() {
  local url=$1 name
  name=$(basename "$url")
  if [[ -s $name ]]; then return; fi
  echo "downloading $name"
  curl -sSf --retry 3 -o "$name.part" "$url" && mv "$name.part" "$name"
}

case "${1:-}" in
  broadcasts)
    curl -sSf https://database.lichess.org/broadcast/list.txt | while read -r url; do fetch "$url"; done
    ;;
  elite)
    from=${2:?from YYYY-MM}; to=${3:?to YYYY-MM}
    y=${from%-*}; m=$((10#${from#*-}))
    while [[ $(printf '%04d-%02d' "$y" "$m") < "$to" || $(printf '%04d-%02d' "$y" "$m") == "$to" ]]; do
      fetch "https://database.nikonoel.fr/lichess_elite_$(printf '%04d-%02d' "$y" "$m").zip"
      m=$((m + 1)); if (( m > 12 )); then m=1; y=$((y + 1)); fi
    done
    ;;
  evals)
    fetch https://database.lichess.org/lichess_db_eval.jsonl.zst
    ;;
  *)
    echo "usage: $0 broadcasts | elite FROM TO | evals" >&2; exit 1
    ;;
esac
