#!/usr/bin/env bash
# Download static TTFs of Google Fonts families (SIL Open Font License) into assets/fonts/.
#   core/bin/fetch-fonts.sh "Poppins:400,600,700" "Inter:400,600" "JetBrains Mono:500,600"
# A family without weights gets 400 and 700. Files are named <Family>-<weight>.ttf (spaces removed).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${WB_FONTS_DIR:-$ROOT/assets/fonts}"
mkdir -p "$OUT"
[ $# -gt 0 ] || { echo "usage: $0 \"Family:400,700\" ..." >&2; exit 1; }
for spec in "$@"; do
  family="${spec%%:*}"; weights="400,700"
  [[ "$spec" == *:* ]] && weights="${spec#*:}"
  query="family=$(printf '%s' "$family" | sed 's/ /+/g'):wght@$(printf '%s' "$weights" | tr ',' ';')"
  # Without a browser user agent the CSS API answers with TrueType sources.
  css="$(curl -fsSL "https://fonts.googleapis.com/css2?$query&display=swap")"
  echo "$css" | awk '/font-weight/ {w=$2; gsub(/;/,"",w)} /src: url/ {match($0, /url\([^)]*\)/); u=substr($0, RSTART+4, RLENGTH-5); print w, u}' |
  while read -r weight url; do
    file="$OUT/$(printf '%s' "$family" | tr -d ' ')-$weight.ttf"
    [ -s "$file" ] || curl -fsSL "$url" -o "$file"
    echo "$file"
  done
done
