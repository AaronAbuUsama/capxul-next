#!/usr/bin/env bash
# Stop the stack. Volumes (database, bench) are kept.
cd "$(dirname "$0")/.." && docker compose down
