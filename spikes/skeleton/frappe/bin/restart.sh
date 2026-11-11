#!/usr/bin/env bash
# Restart the bench container (web, worker, scheduler load the app's Python again) and wait until a site answers.
cd "$(dirname "$0")/.."
docker compose restart bench >/dev/null 2>&1
until [ "$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Frappe-Site-Name: '"${1:-acme}"'.localhost' http://127.0.0.1:8000/api/method/ping)" = 200 ]; do sleep 2; done
