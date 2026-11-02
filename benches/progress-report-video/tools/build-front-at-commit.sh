#!/usr/bin/env bash
# Export a front-end exactly as it was at a commit, optionally build it, and print the folder to serve.
#
#   tools/build-front-at-commit.sh <repo> <ref> [--subdir apps/web] [--build "npm ci && npm run build"]
#                                  [--dist dist] [--env FILE] [--out DIR]
#
# It reads the commit with `git archive`, so the repository is never touched: no checkout, no stash, no branch
# switch, no fetch. The export lands in a fresh temporary folder (or --out), the optional build runs there, and the
# last line of stdout is the folder to serve (everything else goes to stderr), so scripts can do:
#
#   BEFORE=$(tools/build-front-at-commit.sh ~/code/app v2.3.0 --build "npm ci && npm run build" --dist dist)
#
# --env FILE is sourced before the build: use it to point the old build at the same read-only API as the live one
# (for example a VITE_API_URL or NEXT_PUBLIC_API_URL). A build-info.json next to the export records the ref, the
# commit and its date, so every "before" capture can be traced back to the exact revision.
set -euo pipefail

usage() { sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
[ $# -ge 2 ] || usage
repo="$1"; ref="$2"; shift 2
subdir=""; build=""; dist=""; envfile=""; out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --subdir) subdir="$2"; shift 2 ;;
    --build) build="$2"; shift 2 ;;
    --dist) dist="$2"; shift 2 ;;
    --env) envfile="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "unknown option $1" >&2; usage ;;
  esac
done

git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || { echo "$repo is not a git repository" >&2; exit 1; }
sha="$(git -C "$repo" rev-parse --verify "${ref}^{commit}")"
date="$(git -C "$repo" show -s --format=%cI "$sha")"
if [ -z "$out" ]; then out="$(mktemp -d "${TMPDIR:-/tmp}/front-${sha:0:10}-XXXXXX")"; else mkdir -p "$out"; fi
[ -z "$(ls -A "$out" 2>/dev/null)" ] || { echo "$out is not empty" >&2; exit 1; }

echo "exporting ${ref} (${sha:0:10}, ${date}) → $out" >&2
if [ -n "$subdir" ]; then
  git -C "$repo" archive --format=tar "$sha" -- "$subdir" | tar -x -C "$out"
  root="$out/$subdir"
else
  git -C "$repo" archive --format=tar "$sha" | tar -x -C "$out"
  root="$out"
fi

if [ -n "$build" ]; then
  echo "building: $build" >&2
  (
    cd "$root"
    if [ -n "$envfile" ]; then set -a; . "$envfile"; set +a; fi
    bash -c "$build" 1>&2
  )
fi

serve="$root${dist:+/$dist}"
[ -d "$serve" ] || { echo "nothing to serve at $serve" >&2; exit 1; }
cat > "$out/build-info.json" <<EOF
{ "ref": "$ref", "commit": "$sha", "commit_date": "$date", "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)", "subdir": "$subdir", "build": $(printf '%s' "$build" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'), "serve": "$serve" }
EOF
echo "$serve"
