#!/usr/bin/env bash
# Start the box: trust an extra CA if one is mounted, run the box's own Docker daemon, and stay up until stopped.
# Parking stops the box. A world must stop cleanly first, or its supervisor fences it and refuses to start it again,
# so on TERM every running world is stopped (and remembered), and when the box starts again those worlds come back up.
set -uo pipefail
EXTRA_CA=/etc/ssl/certs/capxul-extra-ca.crt
PARKED=/work/.parked-worlds
if [ -s "$EXTRA_CA" ] && ! grep -q "capxul-extra-ca" /etc/ssl/certs/ca-certificates.crt; then
  { echo "# capxul-extra-ca"; cat "$EXTRA_CA"; } >> /etc/ssl/certs/ca-certificates.crt
fi
log() { echo "box-start: $*" >> /var/log/box-start.log; }
worlds() { ls /work/capxul-next/var/worlds/*.json 2>/dev/null | xargs -r -n1 basename | sed 's/\.json$//'; }

park() {
  : > "$PARKED.tmp"
  for w in $(worlds); do
    if run-world inspect "$w" >/dev/null 2>&1; then
      if run-world stop "$w" >>/var/log/box-start.log 2>&1; then echo "$w" >> "$PARKED.tmp"; log "stopped $w"
      else log "could not stop $w cleanly"; fi
    fi
  done
  [ -s "$PARKED.tmp" ] && mv "$PARKED.tmp" "$PARKED" || rm -f "$PARKED.tmp"
  kill -TERM "$DOCKERD"; wait "$DOCKERD"; exit 0
}

rm -f /var/run/docker.pid
dockerd >/var/log/dockerd.log 2>&1 &
DOCKERD=$!
trap park TERM INT

if [ -s "$PARKED" ]; then
  for _ in $(seq 60); do docker info >/dev/null 2>&1 && break; sleep 1; done
  for w in $(cat "$PARKED"); do
    if run-world up "$w" >>/var/log/box-start.log 2>&1; then log "resumed $w"; else log "could not resume $w"; fi
  done
  rm -f "$PARKED"
fi
wait "$DOCKERD"
