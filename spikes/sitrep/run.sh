#!/usr/bin/env bash
# Runs the spike against the blueprint's own toolkit and Effect: ./run.sh prove, or ./run.sh generate.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p node_modules/@capxul
ln -sfn ../../../packages/blueprint-tools/node_modules/effect node_modules/effect
ln -sfn ../../../../packages/blueprint-tools node_modules/@capxul/blueprint-tools
exec node --experimental-strip-types --no-warnings src/main.ts "${1:-prove}"
