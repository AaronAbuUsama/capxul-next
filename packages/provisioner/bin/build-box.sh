#!/usr/bin/env bash
# build-box.sh [tag]: build the world box image (box/Containerfile).
#   CAPXUL_BOX_CHROME  a Chrome for Testing chrome-linux64 folder (default: the one a Claude cloud container has)
#   CAPXUL_BUILD_CA  a CA bundle to trust during the build only (a TLS-inspecting proxy); passed as a secret, never a layer
# Behind a proxy (HTTPS_PROXY set) the build uses the host network and Docker's predefined proxy build arguments.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/../box" && pwd)"
TAG="${1:-capxul-world-box:dev}"
args=(-t "$TAG" -f "$HERE/Containerfile")
if [ -n "${HTTPS_PROXY:-}" ]; then
  args+=(--network host --build-arg "HTTPS_PROXY=$HTTPS_PROXY" --build-arg "HTTP_PROXY=${HTTP_PROXY:-$HTTPS_PROXY}" --build-arg "NO_PROXY=${NO_PROXY:-}")
fi
CHROME="${CAPXUL_BOX_CHROME:-$(ls -d /opt/pw-browsers/chromium-*/chrome-linux64 2>/dev/null | sort -V | tail -1)}"
[ -x "$CHROME/chrome" ] || { echo "build-box: set CAPXUL_BOX_CHROME to a Chrome for Testing chrome-linux64 folder" >&2; exit 2; }
args+=(--build-context "chrome=$CHROME")
CA="${CAPXUL_BUILD_CA:-}"
[ -n "$CA" ] && args+=(--secret "id=build_ca,src=$CA")
DOCKER_BUILDKIT=1 docker build "${args[@]}" "$HERE"
