#!/usr/bin/env bash
# Bench container entrypoint: first run builds the bench in the volume, every run then serves it.
set -euo pipefail
B=/home/frappe/vol/frappe-bench
sudo chown frappe:frappe /home/frappe/vol
cd /home/frappe
export PATH=$HOME/.local/bin:$HOME/.pyenv/shims:$PATH
source ~/.nvm/nvm.sh >/dev/null 2>&1 || true
if [ ! -f $B/.bench-built ]; then
  echo ">>> first run: bench init (frappe $FRAPPE_BRANCH)"
  rm -rf $B
  bench init --skip-redis-config-generation --frappe-branch "$FRAPPE_BRANCH" --frappe-path https://github.com/frappe/frappe $B
  cd $B
  bench set-config -g db_host mariadb
  bench set-config -g redis_cache redis://redis:6379/0
  bench set-config -g redis_queue redis://redis:6379/1
  bench set-config -g redis_socketio redis://redis:6379/2
  bench get-app --branch "$FRAPPE_BRANCH" erpnext https://github.com/frappe/erpnext
  bench get-app --branch "$FRAPPE_BRANCH" hrms https://github.com/frappe/hrms
  touch .bench-built
fi
cd $B
# the capxul app: the mounted directory, installed editable (no git needed)
if [ ! -e apps/capxul ]; then
  ln -s /workspace/capxul apps/capxul
fi
grep -qx capxul sites/apps.txt || printf '\ncapxul\n' >> sites/apps.txt
sed -i '/^$/d' sites/apps.txt
if ! env/bin/python -c 'import capxul' 2>/dev/null; then
  uv pip install --python env/bin/python -e apps/capxul
fi
# Procfile without redis (they are separate containers)
cat > Procfile <<'P'
web: bench serve --port 8000
schedule: bench schedule
worker: bench worker
P
touch .capxul-ready
exec bench start --no-dev 2>&1 || exec bench start
