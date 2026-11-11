#!/usr/bin/env bash
# build.sh [tag]: build the Capxul bench image from apps.lock.json and this repository's capxul app.
#   CAPXUL_APP_DIR   the capxul app's source (default: the spike's app until it graduates into its package)
#   CAPXUL_BUILD_CA  a CA bundle to trust during the build only (a TLS-inspecting proxy); passed as a secret, never a layer
# Behind a proxy (HTTPS_PROXY set) the build uses the host network and the proxy variables, which Docker keeps out of
# the image's history. Prints the image id and writes var/bench-image/image.json (tag, id, inputs).
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
APP="${CAPXUL_APP_DIR:-$ROOT/spikes/skeleton/frappe/capxul}"
[ -f "$APP/pyproject.toml" ] || { echo "no capxul app at $APP" >&2; exit 1; }
rev="$(git -C "$ROOT" rev-parse --short=12 HEAD)"; git -C "$ROOT" diff --quiet HEAD -- "$HERE" "$APP" || rev="$rev-dirty"
TAG="${1:-capxul-bench:$rev}"
lock() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["base"][sys.argv[2]])' "$HERE/apps.lock.json" "$1"; }
args=(--file "$HERE/Containerfile" --build-context "capxul-app=$APP"
      --build-arg "BUILD_IMAGE=$(lock build)" --build-arg "RUNTIME_IMAGE=$(lock runtime)" --tag "$TAG")
if [ -n "${HTTPS_PROXY:-${https_proxy:-}}" ]; then
  args+=(--network host)
  for v in HTTPS_PROXY HTTP_PROXY NO_PROXY https_proxy http_proxy no_proxy YARN_HTTPS_PROXY; do
    [ -n "${!v:-}" ] && args+=(--build-arg "$v=${!v}")
  done
fi
CA="${CAPXUL_BUILD_CA:-}"
[ -n "$CA" ] && args+=(--secret "id=build_ca,src=$CA")
t0=$(date +%s)
DOCKER_BUILDKIT=1 docker build "${args[@]}" "$HERE"
id="$(docker image inspect --format '{{.Id}}' "$TAG")"
mkdir -p "$ROOT/var/bench-image"
python3 - "$ROOT/var/bench-image/image.json" "$TAG" "$id" "$rev" "$APP" "$(( $(date +%s) - t0 ))" <<'PY'
import json, sys
out, tag, iid, rev, app, secs = sys.argv[1:]
json.dump({"tag": tag, "id": iid, "repo_commit": rev, "capxul_app": app, "build_seconds": int(secs)}, open(out, "w"), indent=2)
PY
echo "built $TAG ($id) in $(( $(date +%s) - t0 )) s"
