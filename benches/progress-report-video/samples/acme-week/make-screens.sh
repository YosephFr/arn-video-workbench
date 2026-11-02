#!/usr/bin/env bash
# The sample's before/after screens, made with the real method on a throwaway repository:
#   1. commit the mock dashboard twice (mock-front/v1, then mock-front/v2) into a temporary git repo;
#   2. rebuild each revision from its commit with tools/build-front-at-commit.sh (git archive, nothing checked out);
#   3. serve both on 127.0.0.1 with the SAME read-only API fixture (mock-front/api), so the data is identical;
#   4. capture them headless at 1024×1320 @2x with tools/capture.mjs → captures/*.png + *.json.
# Everything temporary is deleted at the end. Run from anywhere: bash samples/acme-week/make-screens.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The bench is found from this script's own folder: it is two levels up in the bench's samples/, and a copy of the piece
# (core/bin/wb new progress-report-video <name>, in work/ or --dest inside the repository) finds it by walking up to
# the repository root.
BENCH=""
dir="$HERE"
while [ "$dir" != "/" ]; do
  if [ -f "$dir/tools/capture.mjs" ] && [ -f "$dir/tools/build-front-at-commit.sh" ]; then BENCH="$dir"; break; fi
  if [ -f "$dir/benches/progress-report-video/tools/capture.mjs" ]; then BENCH="$dir/benches/progress-report-video"; break; fi
  dir="$(dirname "$dir")"
done
[ -n "$BENCH" ] || { echo "make-screens: no benches/progress-report-video above $HERE; keep the piece inside the repository" >&2; exit 1; }
WORK="$(mktemp -d "${TMPDIR:-/tmp}/acme-front-XXXXXX")"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done; rm -rf "$WORK"; }
trap cleanup EXIT

repo="$WORK/repo"; mkdir -p "$repo"
git -C "$repo" init -q
git -C "$repo" -c user.name=sample -c user.email=sample@acme.example commit -q --allow-empty -m "start"
cp "$HERE/mock-front/v1/index.html" "$repo/index.html"
git -C "$repo" add -A && git -C "$repo" -c user.name=sample -c user.email=sample@acme.example commit -q -m "reports: first version"
cp "$HERE/mock-front/v2/index.html" "$repo/index.html"
git -C "$repo" add -A && git -C "$repo" -c user.name=sample -c user.email=sample@acme.example commit -q -m "reports: totals on top, export, search, scheduled reports"

BEFORE_DIR="$("$BENCH/tools/build-front-at-commit.sh" "$repo" HEAD~1 --out "$WORK/before")"
AFTER_DIR="$("$BENCH/tools/build-front-at-commit.sh" "$repo" HEAD --out "$WORK/after")"

node "$BENCH/tools/serve.mjs" "$BEFORE_DIR" --port 4411 --api "$HERE/mock-front/api" > "$WORK/before.log" 2>&1 & PIDS+=($!)
node "$BENCH/tools/serve.mjs" "$AFTER_DIR" --port 4412 --api "$HERE/mock-front/api" > "$WORK/after.log" 2>&1 & PIDS+=($!)
for port in 4411 4412; do
  for _ in $(seq 1 50); do curl -fs "http://127.0.0.1:$port/" >/dev/null 2>&1 && break; sleep 0.1; done
done

node "$BENCH/tools/capture.mjs" "$HERE/shots.json" --out "$HERE/captures" --var BEFORE=http://127.0.0.1:4411 --var AFTER=http://127.0.0.1:4412
