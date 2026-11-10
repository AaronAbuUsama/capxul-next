#!/usr/bin/env bash
# Stands in for frappe/bin/new-site.sh in test-core.sh. Records how many events the fake had received by now
# (must be 0: Core holds an org's events until its site exists).
echo "$(curl -s "http://127.0.0.1:$FAKE_PORT/_calls" | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).length')" >"$STATE_DIR/calls-at-site-time-$1"
echo "creating $1 (fake)"
echo "{\"site\":\"$1.localhost\",\"url\":\"http://$1.localhost:8000\"}"
