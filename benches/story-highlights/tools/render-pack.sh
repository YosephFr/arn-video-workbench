#!/usr/bin/env bash
# Render every story of a pack, then verify each one.
#   tools/render-pack.sh samples/getting-started [story ...]
# Per story: renders/final.mp4 (with the pack header) and renders/final_reel.mp4 (WB_REEL=1: no header, for the reel).
# Then: python3 tools/reel.py <pack>   and   python3 tools/reel.py <pack> --deliver <folder>
set -euo pipefail
BENCH="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$BENCH/../.." && pwd)"
PACK="${1:?usage: tools/render-pack.sh <pack> [story ...]}"; shift || true
STORIES="$*"
[ -n "$STORIES" ] || STORIES="$(python3 -c "import json,sys; print(' '.join(json.load(open(sys.argv[1]))['stories']))" "$PACK/pack.json")"
for s in $STORIES; do
  node "$BENCH/engine/render.mjs" "$PACK/$s" final
  WB_REEL=1 node "$BENCH/engine/render.mjs" "$PACK/$s" final --name final_reel
  if [ -x "$ROOT/core/bin/wb" ]; then "$ROOT/core/bin/wb" verify "$PACK/$s/renders/final.mp4" || true; fi
done
