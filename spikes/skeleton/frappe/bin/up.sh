#!/usr/bin/env bash
# Bring the Frappe stack up from nothing. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose up -d
echo "waiting for the bench (first run builds it: 10-25 minutes)..."
until docker compose exec -T bench test -f /home/frappe/vol/frappe-bench/.capxul-ready 2>/dev/null; do sleep 5; done
until [ "$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Frappe-Site-Name: none.localhost' http://127.0.0.1:8000/api/method/ping)" != "000" ]; do sleep 3; done
echo "up: http://127.0.0.1:8000 (sites are <slug>.localhost)"
