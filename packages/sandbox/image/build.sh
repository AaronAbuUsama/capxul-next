#!/usr/bin/env bash
# Builds the box image: the repository at the tip of origin/integration/build with its packages installed, and this
# checkout's box server. Prints the image's tag. Usage: packages/sandbox/image/build.sh [base ref, default origin/integration/build]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$(git -C "$here" rev-parse --show-toplevel)"
base="${1:-origin/integration/build}"
commit="$(git -C "$root" rev-parse "$base")"
ctx="$(mktemp -d)"; trap 'rm -rf "$ctx"' EXIT
git clone -q --no-checkout "file://$root" "$ctx/repo"
git -C "$ctx/repo" checkout -q --detach "$commit"
git -C "$ctx/repo" remote remove origin
mkdir -p "$ctx/box/bin" "$ctx/box/modules"
cp "$root/packages/sandbox/src/bin/box.ts" "$ctx/box/bin/"
cp -R "$root/packages/sandbox/src/modules/box" "$ctx/box/modules/"
tag="capxul-box:${commit:0:12}-$(cat "$ctx"/box/modules/box/internal/*.ts "$ctx"/box/bin/box.ts | shasum | cut -c1-8)"
docker build --platform linux/amd64 -q -t "$tag" -f "$here/Dockerfile" "$ctx" >&2
echo "$tag"
