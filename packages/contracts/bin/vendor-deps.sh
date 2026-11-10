#!/usr/bin/env bash
# Rebuilds lib/openzeppelin from the pinned npm tarballs, checking each against the registry's
# published SHA-1. forge-std (v1.9.7, src only) is committed under lib/forge-std with its upstream.json.
# Usage: bash bin/vendor-deps.sh   (needs npm and network; the committed lib/ needs neither)
set -euo pipefail
cd "$(dirname "$0")/.."
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
pins=(
  "@openzeppelin/contracts 5.6.1 90c1cd427b3c1007ada4f42378ce84cc2a2145a5 contracts"
  "@openzeppelin/contracts-upgradeable 5.6.1 7c1a0543bb73f5389e5f6cad268bf0715b7650e6 contracts-upgradeable"
)
rm -rf lib/openzeppelin
for pin in "${pins[@]}"; do
  read -r name version sha dir <<<"$pin"
  (cd "$work" && npm pack "$name@$version" --silent >/dev/null)
  tgz="$work/$(ls "$work" | grep -E '\.tgz$' | head -1)"
  [ "$(shasum "$tgz" | cut -d' ' -f1)" = "$sha" ] || { echo "checksum mismatch for $name@$version" >&2; exit 1; }
  mkdir -p "lib/openzeppelin/$dir" "$work/x"
  tar -xzf "$tgz" -C "$work/x" --strip-components=1
  (cd "$work/x" && find . -name '*.sol' -o -name 'LICENSE' -o -name package.json | cpio -pdm "$OLDPWD/lib/openzeppelin/$dir" 2>/dev/null)
  rm -rf "$work/x" "$tgz"
done
echo "vendored lib/openzeppelin: $(find lib/openzeppelin -name '*.sol' | wc -l | tr -d ' ') .sol files"
