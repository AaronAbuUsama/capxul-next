#!/usr/bin/env bash
# Amp's built-in Debian orb: reusable inputs, no company data or user authentication.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
TOOLS="$HOME/.local/bin"
mkdir -p "$TOOLS"
t0=$SECONDS
step() { echo "[orb setup ${SECONDS}s] $*"; }

step "Native Node 24.22.2, Foundry 1.8.5 and solc 0.8.28 / 0.8.24"
source packages/devnet/orb/native-tools.sh
sudo corepack enable
corepack prepare "$(node -p 'require("./package.json").packageManager')" --activate
pnpm install --frozen-lockfile
# The walking skeleton is deliberately outside the product workspace and has its own lockfile.
(cd spikes/skeleton/core && pnpm install --ignore-workspace --frozen-lockfile)

step "Native PostgreSQL 17 recovery client"
if [ ! -x /usr/lib/postgresql/17/bin/psql ]; then
  sudo apt-get update
  sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql-client-17
fi
# Bypass pg_wrapper's version selection; recovery requires this major even if others are installed.
ln -sfn /usr/lib/postgresql/17/bin/psql "$TOOLS/psql"
psql --version

step "Docker, Compose and Buildx (systemd owns the daemon)"
if ! sudo -n /usr/bin/docker compose version >/dev/null 2>&1 || ! sudo -n /usr/bin/docker buildx version >/dev/null 2>&1; then
  sudo apt-get update
  sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-plugin docker-buildx-plugin
fi
sudo systemctl enable --now docker
# The orb user has sudo but its current process need not be in the docker group.
printf '#!/usr/bin/env bash\nexec sudo -n --preserve-env=COMPOSE_FILE,COMPOSE_PROJECT_NAME /usr/bin/docker "$@"\n' > "$TOOLS/docker"
chmod +x "$TOOLS/docker"
export PATH="$TOOLS:$PATH"
docker info >/dev/null

step "Seed checksums and offline contract artifacts"
(cd packages/contracts/state && sha256sum --check CHECKSUMS)
# Runtime/deployment artifacts, test currency and local sponsor, not the entire fuzz/exhaustive test inventory.
(cd packages/contracts && forge build src test/mocks/MockERC20.sol test/mocks/MockPaymaster.sol --offline)

step "Pinned six-app bench image and backing images"
# Docker's own content cache handles changed lock/app inputs and warm no-op builds.
packages/bench-image/bin/build.sh capxul-bench:orb
docker pull mariadb:11.8
docker pull redis:7.4-alpine
docker pull postgres:17-alpine
step "ready in $((SECONDS - t0))s; start runtime with amp orb services ensure"
