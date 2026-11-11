#!/bin/bash
# Every container of the bench starts here: link the assets built into this image into the sites volume, then run the
# service's command. A new image therefore always serves its own assets, whatever the volume held before.
set -e
umask 0002
B=/home/frappe/frappe-bench
rm -rf "$B/sites/assets"
ln -s "$B/assets" "$B/sites/assets"
exec "$@"
