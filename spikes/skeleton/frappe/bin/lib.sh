# shared by the scripts. Source it.
FRAPPE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$FRAPPE_DIR/../.env"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a
SECRET="${SKELETON_SECRET:-skeleton-dev-secret}"
ADMIN_PASSWORD="${CAPXUL_ADMIN_PASSWORD:-admin}"   # dev only
# run a command inside the bench directory of the bench container
inbench() { docker compose -f "$FRAPPE_DIR/compose.yml" exec -T -w /home/frappe/vol/frappe-bench bench bash -lc "export PATH=\$HOME/.local/bin:\$HOME/.pyenv/shims:\$PATH; $*"; }
