#!/usr/bin/env bash
# A stand-in for Frappe's bench in the blank-sites proof (prove.py): each command takes the time the same step took on
# a real bench (records/site-pool/01-template-source.json, a site made from nothing: 137.4 s in all) times SCALE
# (0.1, as the other stand-in proofs scale the bench). `new-site` writes the site's config, as Frappe does.
set -e
scale="${SCALE:-0.1}"
args="$*"
ms=200
case "$1" in
  new-site) mkdir -p "sites/$2"; echo "{\"db_name\":\"_$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')\",\"encryption_key\":\"k\"}" \
              >"sites/$2/site_config.json"; ms=22226 ;;
  drop-site) ms=2000 ;;
  *) case "$args" in
       *"install-app erpnext"*) ms=50118 ;;
       *"install-app hrms"*) ms=33794 ;;
       *"install-app capxul"*) ms=3396 ;;
       *run_wizard*) ms=16934 ;;
       *" migrate"*) ms=8161 ;;
       *enable-scheduler*) ms=653 ;;
       *join_world*) ms=799 ;;
     esac ;;
esac
sleep "$(awk "BEGIN {print $ms * $scale / 1000}")"
