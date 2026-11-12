#!/usr/bin/env bash
# Runs in the pinned image, under the frappe user. This is the local test server, not the hosted production layout.
set -euo pipefail
cd /home/frappe/frappe-bench
mkdir -p /home/frappe/vol
ln -sfn /home/frappe/frappe-bench /home/frappe/vol/frappe-bench
cp capxul-apps.txt sites/apps.txt
bench set-config -g db_host mariadb
bench set-config -g redis_cache redis://redis:6379/0
bench set-config -g redis_queue redis://redis:6379/1
bench set-config -g redis_socketio redis://redis:6379/2
bench set-config -gp developer_mode 0
cat > Procfile <<'PROCESSES'
web: bench serve --port 8000 --noreload
schedule: bench schedule
worker: bench worker
socketio: node apps/frappe/socketio.js
PROCESSES
touch .capxul-ready
exec bench start --no-dev
