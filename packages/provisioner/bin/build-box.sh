#!/usr/bin/env bash
# build-box.sh [tag]: build the world box image (box/Containerfile).
#   CAPXUL_BUILD_CA  a CA bundle to trust during the build only (a TLS-inspecting proxy); passed as a secret, never a layer
# Behind a proxy (HTTPS_PROXY set) the build uses the host network and Docker's predefined proxy build arguments.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/../box" && pwd)"
TAG="${1:-capxul-world-box:dev}"
args=(-t "$TAG" -f "$HERE/Containerfile")
if [ -n "${HTTPS_PROXY:-}" ]; then
  args+=(--network host --build-arg "HTTPS_PROXY=$HTTPS_PROXY" --build-arg "HTTP_PROXY=${HTTP_PROXY:-$HTTPS_PROXY}" --build-arg "NO_PROXY=${NO_PROXY:-}")
fi
CA="${CAPXUL_BUILD_CA:-}"
[ -n "$CA" ] && args+=(--secret "id=build_ca,src=$CA")
DOCKER_BUILDKIT=1 docker build "${args[@]}" "$HERE"
