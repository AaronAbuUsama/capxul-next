#!/usr/bin/env bash
# Run inside a world box (aaron.alchemy-provisioning): bring a checkout at /work/capxul-next up as one world with the
# devnet supervisor, exactly as on a machine. The box's own Docker daemon runs the bench and the backing databases.
#   run-world.sh prepare           tools, dependencies and contract artifacts (no images, no world)
#   run-world.sh create <world>    init and create the world (needs capxul-bench:orb and the backing images loaded)
#   run-world.sh slice-zero <world>  run the slice-zero acceptance on it
#   run-world.sh up|stop|inspect <world>  start a world again after the box resumes, stop it before the box parks, look at it
# Behind a TLS-inspecting proxy the box's extra CA (box-start.sh) is also what the cloud recipe expects at /root/.ccr.
set -euo pipefail
cd /work/capxul-next
BOX_CA=/etc/ssl/certs/capxul-extra-ca.crt
if [ -n "${HTTPS_PROXY:-}" ] && [ -s "$BOX_CA" ]; then
  mkdir -p /root/.ccr && cp "$BOX_CA" /root/.ccr/ca-bundle.crt
  export NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt
fi
git config --global --add safe.directory /work/capxul-next
cli() { node --experimental-strip-types --no-warnings packages/cli/src/main.ts "$@"; }
env_up() {
  # shellcheck disable=SC1091
  source packages/devnet/cloud/setup.sh >/dev/null
  # shellcheck disable=SC1091
  source packages/devnet/orb/env.sh
  unset COMPOSE_FILE COMPOSE_PROJECT_NAME
}
case "${1:-}" in
  prepare)
    pnpm install --frozen-lockfile
    env_up
    (cd packages/contracts && forge build src test/mocks/MockERC20.sol test/mocks/MockPaymaster.sol --offline)
    ;;
  create)
    env_up
    world="${2:?world id}"
    [ -f "var/worlds/$world.json" ] || cli world init "$world" --config "var/worlds/$world.json"
    cli world create --config "var/worlds/$world.json"
    ;;
  slice-zero)
    env_up
    cli world run slice-zero --config "var/worlds/${2:?world id}.json" --json
    ;;
  up|stop|inspect)
    env_up
    cli world "$1" --config "var/worlds/${2:?world id}.json"
    ;;
  *) echo "usage: run-world.sh prepare | create <world> | slice-zero <world> | up|stop|inspect <world>" >&2; exit 2 ;;
esac
