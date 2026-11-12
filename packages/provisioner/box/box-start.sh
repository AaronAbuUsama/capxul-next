#!/usr/bin/env bash
# Start the box: trust an extra CA if one is mounted, run the box's own Docker daemon, and stay up until stopped.
set -euo pipefail
EXTRA_CA=/etc/ssl/certs/capxul-extra-ca.crt
if [ -s "$EXTRA_CA" ] && ! grep -q "capxul-extra-ca" /etc/ssl/certs/ca-certificates.crt; then
  { echo "# capxul-extra-ca"; cat "$EXTRA_CA"; } >> /etc/ssl/certs/ca-certificates.crt
fi
rm -f /var/run/docker.pid
dockerd >/var/log/dockerd.log 2>&1 &
DOCKERD=$!
trap 'kill -TERM "$DOCKERD"; wait "$DOCKERD"' TERM INT
wait "$DOCKERD"
