#!/usr/bin/env bash
# require.sh: fails a CI job, loudly, when a secret or setting it needs is missing, naming each one and where it comes
# from. A job that cannot run must be red, never skipped: a skipped check is not a green one.
#   bin/require.sh NAME...        each NAME is an environment variable the job maps from a secret or a variable
set -uo pipefail
missing=()
for name in "$@"; do [ -n "${!name:-}" ] || missing+=("$name"); done
if [ "${#missing[@]}" -gt 0 ]; then
  for name in "${missing[@]}"; do
    echo "::error title=Missing ${name}::${name} is not set. The repository secrets and variables are made by packages/platform/bootstrap (BOOTSTRAP.md), which Aaron runs once. A pull request from a fork gets no secrets."
  done
  exit 1
fi
echo "require: ${*} present"
