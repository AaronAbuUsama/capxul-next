#!/usr/bin/env bash
# Builds the box image, pushes it to Cloudflare's registry, deploys the Worker, and leaves its address and key in
# var/sandbox/box.json (git-ignored, mode 600), where the loop finds them. Safe to repeat: the key is made once and kept.
# Usage: packages/sandbox/deploy.sh [base ref]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$(git -C "$here" rev-parse --show-toplevel)"
# The key lives in the checkout the loop runs from (the main one), not in a worktree that builds the image.
home="${LOOP_HOME:-$(git -C "$root" worktree list --porcelain | head -1 | sed 's/^worktree //')}"
wrangler=(npx --yes wrangler@4.150.0)
tag="$("$here/image/build.sh" "${1:-origin/integration/build}")"
echo "image $tag" >&2
pushed="$(cd /tmp && "${wrangler[@]}" containers push "$tag" 2>&1 | tee /dev/stderr | grep -Eo 'registry\.cloudflare\.com/[^ ]+' | tail -1)"
[ -n "$pushed" ] || { echo "the push named no image" >&2; exit 1; }
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
cp "$here/worker/index.ts" "$work/index.ts"
sed "s|\"IMAGE\"|\"$pushed\"|" "$here/worker/wrangler.jsonc" > "$work/wrangler.jsonc"
mkdir -p "$home/var/sandbox"; chmod 700 "$home/var/sandbox"
file="$home/var/sandbox/box.json"
key="$( [ -f "$file" ] && node -p "require('$file').key" || openssl rand -hex 32 )"
url="$(cd "$work" && "${wrangler[@]}" deploy 2>&1 | tee /dev/stderr | grep -Eo 'https://[a-z0-9.-]+\.workers\.dev' | head -1)"
[ -n "$url" ] || { echo "the deploy named no address" >&2; exit 1; }
printf '%s' "$key" | (cd "$work" && "${wrangler[@]}" secret put BOX_KEY >/dev/null)
umask 077; printf '{"url":"%s","key":"%s","image":"%s"}\n' "$url" "$key" "$pushed" > "$file"
echo "deployed $url with $pushed; the key is in $file" >&2
