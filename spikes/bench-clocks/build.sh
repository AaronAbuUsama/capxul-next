#!/usr/bin/env bash
# build.sh: build $BENCH_IMAGE (default bench-clocks:spike) (pinned Frappe and ERPNext plus the capxul app) and pull MariaDB and Redis.
# Behind a TLS-inspecting proxy (HTTPS_PROXY set) the build uses the host network, the proxy variables and
# CAPXUL_BUILD_CA (default /root/.ccr/ca-bundle.crt when it exists) as a build secret, as packages/bench-image does.
set -euo pipefail
BENCH_IMAGE="${BENCH_IMAGE:-bench-clocks:spike}"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
LOCK="$ROOT/packages/bench-image/apps.lock.json"
pin() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2], {"d": d}))' "$LOCK" "$1"; }
args=(--file "$HERE/Containerfile" --build-context "capxul-app=$ROOT/packages/frappe-app" --tag "$BENCH_IMAGE"
      --build-arg "BUILD_IMAGE=$(pin 'd["base"]["build"]')" --build-arg "FRAPPE_URL=$(pin 'd["frappe"]["url"]')"
      --build-arg "FRAPPE_TAG=$(pin 'd["frappe"]["tag"]')" --build-arg "FRAPPE_COMMIT=$(pin 'd["frappe"]["commit"]')"
      --build-arg "ERPNEXT_URL=$(pin 'd["apps"][0]["url"]')" --build-arg "ERPNEXT_COMMIT=$(pin 'd["apps"][0]["commit"]')")
if [ -n "${HTTPS_PROXY:-${https_proxy:-}}" ]; then
  args+=(--network host)
  for v in HTTPS_PROXY HTTP_PROXY NO_PROXY https_proxy http_proxy no_proxy YARN_HTTPS_PROXY; do
    [ -n "${!v:-}" ] && args+=(--build-arg "$v=${!v}")
  done
fi
CA="${CAPXUL_BUILD_CA:-}"; [ -z "$CA" ] && [ -f /root/.ccr/ca-bundle.crt ] && CA=/root/.ccr/ca-bundle.crt
[ -n "$CA" ] && args+=(--secret "id=build_ca,src=$CA")
t0=$SECONDS
DOCKER_BUILDKIT=1 docker build "${args[@]}" "$HERE"
docker pull -q public.ecr.aws/docker/library/mariadb:11.8      # the official images, from Amazon's mirror of Docker Hub
docker pull -q public.ecr.aws/docker/library/redis:7.4-alpine
echo "built $BENCH_IMAGE in $((SECONDS - t0)) s: $(docker image inspect --format '{{.Size}}' "$BENCH_IMAGE") bytes"
