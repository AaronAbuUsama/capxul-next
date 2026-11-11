# shared by the bench scripts. Source it. Defaults are for a local run; the machine sets every variable.
BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$BENCH_DIR/../.." && pwd)"
export CAPXUL_BENCH_PROJECT="${CAPXUL_BENCH_PROJECT:-capxul-bench}"
export CAPXUL_BENCH_IMAGE="${CAPXUL_BENCH_IMAGE:-capxul-bench:dev}"
export CAPXUL_ENV_DIR="${CAPXUL_ENV_DIR:-$REPO_ROOT/var/bench-image/env}"
export CAPXUL_VOLUMES="${CAPXUL_VOLUMES:-$REPO_ROOT/var/bench-image/volumes}"
export CAPXUL_BENCH_PORT="${CAPXUL_BENCH_PORT:-8080}"
dc() { docker compose -f "$BENCH_DIR/compose.yaml" "$@"; }
# run a command in the site-admin container (same image, the sites folder, the database root password)
admin() { dc --profile admin run --rm -T site-admin "$@"; }
# run a bench command in the running backend container
inbench() { dc exec -T backend "$@"; }
