# shellcheck shell=bash
# rehearse-drift.sh: step 3 (drift) of bin/rehearse.sh, which sources this file.
# Three changes by hand, each of a different kind: a setting in Cloudflare (the platform's door record), a process
# stopped on the host (the bench's worker), and code replaced inside a running container (the site door).

cfapi() { curl -sS --fail-with-body --max-time 20 -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN:-proxy-injected}" "$@"; }
doorRecord() {
  local z; z=$(cfapi "https://api.cloudflare.com/client/v4/zones?name=${PLATFORM_ZONE_NAME:-abuusama.dev}" | python3 -c "import json,sys; print(json.load(sys.stdin)['result'][0]['id'])")
  cfapi "https://api.cloudflare.com/client/v4/zones/$z/dns_records?name=$PLATFORM_STAGE-door.${PLATFORM_DOMAIN:-worlds.abuusama.dev}" \
    | python3 -c 'import json,sys; r=json.load(sys.stdin)["result"]; assert len(r) == 1; print(sys.argv[1], r[0]["id"], r[0]["content"])' "$z"
}
check() { bin/run.sh bun src/run-drift.ts "$PLATFORM_STAGE" "$VAR/drift.json" >/dev/null 2>&1; local code=$?; cat "$VAR/drift.json"; return $code; }

step3() {
  say "3. drift check on the clean platform (src/run-drift.ts: Alchemy's scan plus the code check)"
  WANT=0 timed "drift check, clean" "$T_DRIFT" check
  cp "$VAR/drift.json" "$REC/drift-clean.json"
  say "3. change three things by hand"
  read -r zone rid content < <(doorRecord)
  echo "DNS record $PLATFORM_STAGE-door before: $content"
  cfapi -X PATCH -H 'Content-Type: application/json' -d '{"content":"\"changed by hand\""}' \
    "https://api.cloudflare.com/client/v4/zones/$zone/dns_records/$rid" \
    | python3 -c 'import json,sys; r=json.load(sys.stdin)["result"]; print("DNS record after the edit:", r["name"], r["content"])'
  docker --context "$CTX" stop "$C-worker" >/dev/null && echo "stopped $C-worker"
  docker --context "$CTX" exec "$C-door" bash -c 'echo "# changed by hand" >>/opt/door/door.py' \
    && echo "appended a line to /opt/door/door.py inside $C-door (the door keeps running)"
  say "3. the pinned alchemy drift (2.0.0-beta.85), for comparison"
  WANT=0 timed "alchemy drift, after hand changes" "$T_DRIFT" alc drift --stage "$PLATFORM_STAGE"
  say "3. the drift check"
  WANT=2 timed "drift check, after hand changes" "$T_DRIFT" check
  cp "$VAR/drift.json" "$REC/drift-drifted.json"
  say "3. repair: recreate each container whose code changed, then alchemy drift --repair"
  for name in $(python3 -c 'import json,sys; print(" ".join(c["container"] for c in json.load(open(sys.argv[1]))["code"]))' "$VAR/drift.json"); do
    docker --context "$CTX" rm -f "$name" >/dev/null && echo "removed $name (its code changed; the repair recreates it from its image)"
  done
  timed "alchemy drift --repair" "$T_DRIFT" alc drift --stage "$PLATFORM_STAGE" --repair
  WANT=0 timed "drift check, after repair" "$T_DRIFT" check
  cp "$VAR/drift.json" "$REC/drift-repaired.json"
  read -r zone rid content < <(doorRecord)
  echo "DNS record $PLATFORM_STAGE-door after repair: $content"
  echo "hand line in the door's code after repair: $(docker --context "$CTX" exec "$C-door" grep -c 'changed by hand' /opt/door/door.py)"
  echo "site still there after repair: $(web "$SITE" /api/method/capxul.clock.now)"
  inventory
}
