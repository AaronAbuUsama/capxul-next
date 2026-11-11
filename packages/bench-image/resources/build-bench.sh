#!/usr/bin/env bash
# Runs inside the builder stage: build-bench.sh <apps.lock.json> <capxul app dir> <bench dir>
# Makes the bench from the pinned commits, refuses any checkout whose commit is not the pinned one, builds production
# assets, and writes capxul-image.json (what is inside, for receipts and the dataset manifest).
set -euo pipefail
LOCK="$1"; CAPXUL_SRC="$2"; B="$3"
if [ -s /run/secrets/build_ca ]; then
  export SSL_CERT_FILE=/run/secrets/build_ca REQUESTS_CA_BUNDLE=/run/secrets/build_ca CURL_CA_BUNDLE=/run/secrets/build_ca \
         NODE_EXTRA_CA_CERTS=/run/secrets/build_ca GIT_SSL_CAINFO=/run/secrets/build_ca PIP_CERT=/run/secrets/build_ca UV_NATIVE_TLS=1
fi
export PATH="$HOME/.local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null
j() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2], {"d": d}))' "$LOCK" "$1"; }
pin() {   # pin <dir> <commit>: the checkout must be exactly the pinned commit
  local got; got="$(git -C "$1" rev-parse HEAD)"
  [ "$got" = "$2" ] || { echo "PIN MISMATCH in $1: got $got, pinned $2" >&2; exit 1; }
}
t0=$(date +%s); step() { echo "[build-bench $(( $(date +%s) - t0 ))s] $*"; }

step "bench init: frappe $(j 'd["frappe"]["tag"]')"
bench init --frappe-path "$(j 'd["frappe"]["url"]')" --frappe-branch "$(j 'd["frappe"]["tag"]')" \
  --no-procfile --no-backups --skip-redis-config-generation --skip-assets --verbose "$B"
pin "$B/apps/frappe" "$(j 'd["frappe"]["commit"]')"
cd "$B"

n=$(j 'len(d["apps"])')
for i in $(seq 0 $((n - 1))); do
  name=$(j "d['apps'][$i]['name']"); url=$(j "d['apps'][$i]['url']"); commit=$(j "d['apps'][$i]['commit']")
  step "app $name at $commit"
  git init -q "apps/$name"
  git -C "apps/$name" fetch -q --depth 1 "$url" "$commit"
  git -C "apps/$name" -c advice.detachedHead=false checkout -q FETCH_HEAD
  pin "apps/$name" "$commit"
  uv pip install --quiet --python env/bin/python -e "apps/$name"
  if [ -f "apps/$name/package.json" ]; then (cd "apps/$name" && yarn install --check-files --non-interactive); fi
done

step "app capxul from this repository"
cp -r "$CAPXUL_SRC" apps/capxul
find apps/capxul -name '__pycache__' -prune -exec rm -rf {} +
uv pip install --quiet --python env/bin/python -e apps/capxul

printf '%s\n' frappe $(python3 -c 'import json,sys; print(" ".join(a["name"] for a in json.load(open(sys.argv[1]))["apps"]))' "$LOCK") capxul > sites/apps.txt
echo '{}' > sites/common_site_config.json

step "bench build --production"
bench build --production

# What the image holds, read from the built bench rather than restated from the lock.
python3 - "$B" "$LOCK" <<'PY'
import json, subprocess, sys, pathlib, hashlib
b, lock = pathlib.Path(sys.argv[1]), json.load(open(sys.argv[2]))
def ver(app):
    out = subprocess.run([str(b / "env/bin/python"), "-c", f"import {app}; print({app}.__version__)"], capture_output=True, text=True)
    return out.stdout.strip() or None
apps = [{"name": "frappe", "tag": lock["frappe"]["tag"], "commit": lock["frappe"]["commit"]}] + \
       [{"name": a["name"], "tag": a["tag"], "commit": a["commit"]} for a in lock["apps"]]
for a in apps:
    a["version"] = ver(a["name"])
src = sorted(p for p in (b / "apps/capxul").rglob("*") if p.is_file())
h = hashlib.sha256()
for p in src:
    h.update(str(p.relative_to(b / "apps/capxul")).encode()); h.update(p.read_bytes())
apps.append({"name": "capxul", "source": "this repository", "tree_sha256": h.hexdigest(), "version": ver("capxul")})
json.dump({"schema": "capxul-bench-image/1", "base": lock["base"], "apps": apps}, open(b / "capxul-image.json", "w"), indent=2)
print(json.dumps(apps))
PY

step "trim: no git history, no caches in the image"
find apps -mindepth 2 -maxdepth 2 -name .git -type d -exec rm -rf {} +
rm -rf "$HOME/.cache" "$B/sites/apps.json"
chmod -R g=u "$B"
step "done"
