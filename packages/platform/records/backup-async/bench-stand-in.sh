#!/usr/bin/env bash
# A stand-in for Frappe's bench: `new-site <site>` takes NEW_SITE_SECONDS for a site whose name holds "slow" (another
# world's site made from nothing), 1 s otherwise; `backup` writes one dump and takes 2 s; anything else 0.2 s.
set -e
args="$*"
case "$1" in
  new-site) mkdir -p "sites/$2"; echo '{"db_name":"_x","encryption_key":"k"}' > "sites/$2/site_config.json"
            if [[ "$2" == slow* ]]; then sleep "${NEW_SITE_SECONDS:-130}"; else sleep 1; fi ;;
  drop-site) sleep 1 ;;
  *) if [[ "$args" == *" backup "* ]]; then
       p="${args##*--backup-path }"; p="${p%% *}"; sleep 2
       echo dump | gzip > "$p/20261114_000000-site-database.sql.gz"
     else sleep 0.2; fi ;;
esac
