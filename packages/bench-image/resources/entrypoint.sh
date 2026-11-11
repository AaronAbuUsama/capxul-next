#!/bin/bash
# Every container of the bench starts here: link the assets built into this image into the sites volume, then run the
# service's command. A new image therefore always serves its own assets, whatever the volume held before.
# Several containers start at once on the same volume, so the link is replaced atomically (a fresh link renamed over
# the old one), never removed and recreated.
set -e
umask 0002
B=/home/frappe/frappe-bench
L="$B/sites/assets"
if [ "$(readlink "$L" 2>/dev/null)" != "$B/assets" ]; then
  [ -L "$L" ] || rm -rf "$L"                                  # a real folder left by an older layout
  tmp="$B/sites/.assets.$HOSTNAME.$$"
  ln -sfn "$B/assets" "$tmp"
  mv -Tf "$tmp" "$L"
fi
exec "$@"
