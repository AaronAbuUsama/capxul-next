#!/usr/bin/env bash
# The stack box's entry: dockerd first (as Cloudflare documents it: root, no iptables, no IP forwarding; inner
# containers use the host network), then the box server in the foreground.
set -u
mkdir -p /var/log
dockerd --iptables=false --ip6tables=false --ip-forward=false >/var/log/dockerd.log 2>&1 &
for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 0.5; done
exec node --experimental-strip-types --no-warnings /opt/capxul/packages/sandbox/src/bin/box.ts
