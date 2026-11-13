#!/usr/bin/env bash
# forward.sh: opens, or closes, the way from this machine to the bench host's Docker engine. The bench host accepts no
# inbound traffic; its engine listens on the machine's own loopback (src/user-data.ts). This opens an SSM port
# forward from 127.0.0.1:$PLATFORM_FORWARD_PORT here to that port there, which needs the CI role's
# ssm:StartSession, not an open port. bin/run.sh's PLATFORM_HOST=aws then reaches the engine through it.
#   bin/forward.sh open <stage>     waits until the machine is registered with SSM and its engine answers
#   bin/forward.sh close
# Needs the aws command line and Session Manager's plugin, and an AWS session (in CI, the OIDC role's).
set -euo pipefail
PORT="${PLATFORM_FORWARD_PORT:-23750}" REMOTE=2375
PID="${RUNNER_TEMP:-/tmp}/capxul-forward-$PORT.pid" LOG="${RUNNER_TEMP:-/tmp}/capxul-forward-$PORT.log"
wait_for() { # wait_for <seconds> <what> <command...>
  local limit="$1" what="$2"; shift 2; local t=0
  until "$@" >/dev/null 2>&1; do
    t=$((t + 5)); [ "$t" -le "$limit" ] || { echo "forward: $what did not happen within $limit s" >&2; return 1; }
    sleep 5
  done
  echo "forward: $what after about $t s"
}

case "${1:-}" in
  open)
    STAGE="${2:?usage: forward.sh open <stage>}"
    NAME="capxul-bench-$STAGE"
    ID="$(aws ec2 describe-instances --filters "Name=tag:Name,Values=$NAME" "Name=instance-state-name,Values=pending,running" \
      --query 'Reservations[].Instances[].InstanceId' --output text)"
    [ -n "$ID" ] && [ "$(wc -w <<<"$ID")" -eq 1 ] || { echo "forward: expected one running machine named $NAME, found '$ID'" >&2; exit 1; }
    echo "forward: $NAME is $ID"
    online() { [ "$(aws ssm describe-instance-information --filters "Key=InstanceIds,Values=$ID" \
      --query 'InstanceInformationList[0].PingStatus' --output text)" = Online ]; }
    wait_for 600 "the machine registered with SSM" online
    "$0" close >/dev/null 2>&1 || true
    aws ssm start-session --target "$ID" --document-name AWS-StartPortForwardingSession \
      --parameters "portNumber=$REMOTE,localPortNumber=$PORT" >"$LOG" 2>&1 &
    echo $! >"$PID"
    # The first boot installs Docker after the data disk is attached and formatted (src/user-data.ts).
    wait_for 900 "the engine answered on 127.0.0.1:$PORT" docker -H "tcp://127.0.0.1:$PORT" info
    docker -H "tcp://127.0.0.1:$PORT" info --format 'forward: engine {{.ServerVersion}}, root {{.DockerRootDir}}, {{.NCPU}} CPUs, {{.MemTotal}} bytes'
    ;;
  close)
    if [ -s "$PID" ]; then kill "$(cat "$PID")" 2>/dev/null || true; rm -f "$PID"; echo "forward: closed"; fi
    ;;
  *) echo "usage: forward.sh open <stage> | close" >&2; exit 2 ;;
esac
