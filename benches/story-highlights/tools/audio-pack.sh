#!/usr/bin/env bash
# The audio of a whole pack: voices and timelines per story, one music bed sliced across the pack, then effects and
# mix per story. Uses the providers in each script.json (WB_TTS_PROVIDER=silent to block out timing for free).
#   tools/audio-pack.sh samples/getting-started
set -euo pipefail
BENCH="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WB="$(cd "$BENCH/../.." && pwd)/core/bin/wb"
PACK="${1:?usage: tools/audio-pack.sh <pack>}"
STORIES="$(python3 -c "import json,sys; print(' '.join(json.load(open(sys.argv[1]))['stories']))" "$PACK/pack.json")"
for s in $STORIES; do "$WB" voice "$PACK/$s"; "$WB" timeline "$PACK/$s"; done
python3 "$BENCH/tools/pack_music.py" "$PACK"
for s in $STORIES; do
  node "$BENCH/engine/render.mjs" "$PACK/$s" events
  "$WB" sfx "$PACK/$s"
  "$WB" mix "$PACK/$s"
done
