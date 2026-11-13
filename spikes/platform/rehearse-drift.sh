# rehearse-drift.sh: steps 3 (drift) and 4 (swap the host) of rehearse.sh, which sources this file.
# Three changes by hand, each of a different kind: a setting in Cloudflare (the platform's own DNS record), a process
# stopped on the host (the bench's worker), and code replaced inside a running container (the site door).

doorRecordId() {
  local z; z=$(curl -sS --max-time 20 "https://api.cloudflare.com/client/v4/zones?name=${PLATFORM_ZONE_NAME:-abuusama.dev}" | python3 -c "import json,sys; print(json.load(sys.stdin)['result'][0]['id'])")
  curl -sS --max-time 20 "https://api.cloudflare.com/client/v4/zones/$z/dns_records?name=$PLATFORM_STAGE-door.${PLATFORM_DOMAIN:-worlds.abuusama.dev}" \
    | python3 -c 'import json,sys; r=json.load(sys.stdin)["result"]; assert len(r) == 1; print(sys.argv[1], r[0]["id"], r[0]["content"])' "$z"
}
check() { ./run.sh bun src/run-drift.ts "$PLATFORM_STAGE" 2>/dev/null | sed -n '/^{/,/^}/p' | tee "$VAR/drift.json"; return "${PIPESTATUS[0]}"; }

step3() {
  say "3. drift check on the clean platform (src/run-drift.ts: Alchemy's scan plus the code check)"
  WANT=0 timed "drift check, clean" "$T_DRIFT" check
  say "3. change three things by hand"
  read -r zone rid content < <(doorRecordId)
  echo "DNS record $PLATFORM_STAGE-door before: $content"
  curl -sS -X PATCH -H 'Content-Type: application/json' -d '{"content":"\"changed by hand\""}' \
    "https://api.cloudflare.com/client/v4/zones/$zone/dns_records/$rid" \
    | python3 -c 'import json,sys; r=json.load(sys.stdin)["result"]; print("DNS record after the edit:", r["name"], r["content"])'
  docker --context "$CTX" stop "$C-worker" >/dev/null && echo "stopped $C-worker"
  docker --context "$CTX" exec "$C-door" bash -c 'echo "# changed by hand" >>/opt/door/door.py' \
    && echo "appended a line to /opt/door/door.py inside $C-door (the door keeps running)"
  say "3. the pinned alchemy drift (2.0.0-beta.85)"
  WANT=0 timed "alchemy drift, after hand changes" "$T_DRIFT" alc drift --stage "$PLATFORM_STAGE"
  say "3. the drift check"
  WANT=2 timed "drift check, after hand changes" "$T_DRIFT" check
  say "3. repair: recreate each container whose code changed, then alchemy drift --repair"
  for name in $(python3 -c 'import json,sys; print(" ".join(c["container"] for c in json.load(open(sys.argv[1]))["code"]))' "$VAR/drift.json"); do
    docker --context "$CTX" rm -f "$name" >/dev/null && echo "removed $name (its code changed; repair recreates it from the image)"
  done
  timed "alchemy drift --repair" "$T_DRIFT" alc drift --stage "$PLATFORM_STAGE" --repair
  WANT=0 timed "drift check, after repair" "$T_DRIFT" check
  read -r zone rid content < <(doorRecordId)
  echo "DNS record $PLATFORM_STAGE-door after repair: $content"
  echo "hand line in the door's code after repair: $(docker --context "$CTX" exec "$C-door" grep -c 'changed by hand' /opt/door/door.py)"
  echo "site still there after repair: $(web "$SITE" /api/method/capxul.clock.now)"
  inventory
}

step4() {
  say "4. swap the host: the only code that names the machine"
  (cd "$HERE" && grep -rn 'PLATFORM_DOCKER_HOST' --include='*.ts' --include='*.sh' . | grep -v node_modules | grep -v '^./rehearse')
  local other="ssh://deploy@192.0.2.10"   # TEST-NET-1: a documentation address, no machine answers it
  say "4. plan a new stage pr-r3 on another machine ($other): the same resources, all through its context"
  PLATFORM_DOCKER_HOST="$other" timed "plan pr-r3 on another host" 120 alc plan --stage pr-r3
  say "4. plan the live stage $PLATFORM_STAGE with the other machine's endpoint"
  PLATFORM_DOCKER_HOST="$other" timed "plan $PLATFORM_STAGE with another endpoint" 120 alc plan --stage "$PLATFORM_STAGE"
  echo "(step 4 deployed nothing: both were plans)"
}
