#!/usr/bin/env bash
# Publishes images that Docker built on this machine but could not push, through the session's HTTPS proxy.
#
# In an agent's container the Docker daemon has no route out (it is not started with the session's proxy), so a
# deploy that has to publish a changed image builds it, then fails at the push. Alchemy names each image by a hash
# of its inputs and reuses a tag the registry already lists, so once this script has pushed the tags the failed
# deploy names, the next deploy needs no Docker at all. Usage, with the tags from the failed deploy's log:
#   images/publish.sh capxulworld-anvil:07f1b47d54efc737 capxulworld-ponder:ccc0b469f2a363b5
#
# It talks to the registry's HTTP API with curl. The registry password is minted for 30 minutes, kept in a file
# only this user can read, removed on exit, and never printed.
set -euo pipefail
[ "$#" -gt 0 ] || { echo "usage: $0 <repository:tag>..." >&2; exit 2; }
api=https://api.cloudflare.com/client/v4
registry=https://registry.cloudflare.com
account="${CLOUDFLARE_ACCOUNT_ID:-$(curl -sS --max-time 20 "$api/accounts?per_page=5" | python3 -c "import json,sys; print(json.load(sys.stdin)['result'][0]['id'])")}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
umask 077
curl -sS --fail --max-time 30 -X POST "$api/accounts/$account/containers/registries/registry.cloudflare.com/credentials" \
  -H 'Content-Type: application/json' -d '{"expiration_minutes":30,"permissions":["pull","push"]}' |
  python3 -c '
import base64, json, sys
result = json.load(sys.stdin)["result"]
pair = ((result.get("username") or "v1") + ":" + result["password"]).encode()
print("Authorization: Basic " + base64.b64encode(pair).decode())' >"$work/auth"

call() { curl -sS --max-time 900 -H @"$work/auth" "$@"; }

for ref in "$@"; do
  repository="${ref%%:*}" tag="${ref##*:}"
  image="registry.cloudflare.com/$account/$ref"
  layout="$work/$repository"
  mkdir -p "$layout"
  echo "publish: saving $ref" >&2
  docker save "$image" | tar -x -C "$layout"
  # The image's linux/amd64 manifest, its media type, and the blobs it names (config first, then layers).
  python3 - "$layout" >"$layout/plan" <<'EOF'
import json, sys
root = sys.argv[1]
blob = lambda digest: json.load(open(f"{root}/blobs/{digest.replace(':', '/')}"))
entry = json.load(open(f"{root}/index.json"))["manifests"][0]
while entry["mediaType"].endswith(("image.index.v1+json", "manifest.list.v2+json")):
    entry = next(m for m in blob(entry["digest"])["manifests"]
                 if m.get("platform", {}).get("architecture") == "amd64" and m.get("platform", {}).get("os") == "linux")
manifest = blob(entry["digest"])
print(entry["digest"], entry["mediaType"])
for item in [manifest["config"], *manifest["layers"]]:
    print(item["digest"])
EOF
  read -r manifest media <"$layout/plan"
  path="/v2/$account/$repository"
  tail -n +2 "$layout/plan" | while read -r digest; do
    if [ "$(call -o /dev/null -w '%{http_code}' -I "$registry$path/blobs/$digest")" = 200 ]; then continue; fi
    location="$(call -o /dev/null -w '%{redirect_url}%header{location}' -X POST "$registry$path/blobs/uploads/")"
    case "$location" in /*) location="$registry$location" ;; esac
    case "$location" in *\?*) target="$location&digest=$digest" ;; *) target="$location?digest=$digest" ;; esac
    echo "publish: $repository: uploading $digest" >&2
    call --fail -o /dev/null -X PUT -H 'Content-Type: application/octet-stream' \
      --data-binary @"$layout/blobs/${digest/://}" "$target"
  done
  call --fail -o /dev/null -X PUT -H "Content-Type: $media" \
    --data-binary @"$layout/blobs/${manifest/://}" "$registry$path/manifests/$tag"
  echo "publish: $ref is in the registry as $manifest" >&2
  rm -rf "$layout"
done
