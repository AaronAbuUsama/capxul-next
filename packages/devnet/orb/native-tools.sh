#!/usr/bin/env bash
# Reusable in an orb without Docker or a checkout; all downloaded executables are checksum-verified.
set -euo pipefail
TOOLS="$HOME/.local/bin"
mkdir -p "$TOOLS"
export PATH="$TOOLS:$PATH"

if [ "$(node --version)" != v24.22.2 ]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL --retry 3 https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-x64.tar.xz -o "$tmp/node.tar.xz"
  echo "48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75  $tmp/node.tar.xz" | sha256sum --check
  sudo tar -xJf "$tmp/node.tar.xz" -C /usr/local --strip-components=1
  rm -rf "$tmp"
  trap - EXIT
fi

if ! forge --version 2>/dev/null | head -1 | grep -q '1.8.5'; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL --retry 3 https://github.com/foundry-rs/foundry/releases/download/v1.8.5/foundry_v1.8.5_linux_amd64.tar.gz -o "$tmp/foundry.tar.gz"
  echo "6c66ffcc55fa4249197721baa3098bc208014ea1d8aa04b2ed50ac6bccffb226  $tmp/foundry.tar.gz" | sha256sum --check
  tar -xzf "$tmp/foundry.tar.gz" -C "$TOOLS" anvil forge cast
  rm -rf "$tmp"
  trap - EXIT
fi

while read -r version release checksum; do
  solc="$HOME/.svm/$version/solc-$version"
  if [ ! -x "$solc" ]; then
    mkdir -p "$(dirname "$solc")"
    curl -fsSL --retry 3 "https://binaries.soliditylang.org/linux-amd64/solc-linux-amd64-v$release" -o "$solc.tmp"
    echo "$checksum  $solc.tmp" | sha256sum --check
    chmod +x "$solc.tmp"
    mv "$solc.tmp" "$solc"
  fi
done <<'COMPILERS'
0.8.28 0.8.28+commit.7893614a 9a0fb7e0db2c0641dbae1c5cc645dc686820c83af516226abb1c0a2f76636f25
0.8.24 0.8.24+commit.e11b9ed9 fb03a29a517452b9f12bcf459ef37d0a543765bb3bbc911e70a87d6a37c30d5f
COMPILERS
