#!/usr/bin/env bash
# zone.sh: what the test zone holds, without printing any of Aaron's records: how many records it has, how many are
# under PLATFORM_DOMAIN (the only names this rehearsal may create), and a print (SHA-256, first 16 hex digits) of
# every other record's id, name, type, content and proxy flag (never the records themselves). The same print before and after shows that no other
# record was changed, added or deleted.
set -euo pipefail
ZONE="${PLATFORM_ZONE_NAME:-abuusama.dev}" DOMAIN="${PLATFORM_DOMAIN:-worlds.abuusama.dev}"
cf() { curl -sS --fail-with-body --max-time 30 -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN:-proxy-injected}" "https://api.cloudflare.com/client/v4/$1"; }
Z="$(cf "zones?name=$ZONE" | python3 -c "import json,sys; print(json.load(sys.stdin)['result'][0]['id'])")"
cf "zones/$Z/dns_records?per_page=1000" | python3 -c '
import hashlib, json, sys
zone, domain = sys.argv[1], sys.argv[2]
d = json.load(sys.stdin)
rs = d["result"]
assert d["result_info"]["total_count"] == len(rs), "more records than one page"
mine = [r for r in rs if r["name"] == domain or r["name"].endswith("." + domain)]
others = sorted("|".join(str(r[k]) for k in ("id", "name", "type", "content", "proxied")) for r in rs if r not in mine)
print(f"zone {zone}: {len(rs)} records; under {domain}: {len(mine)}", sorted((r["name"], r["type"]) for r in mine))
print(f"zone {zone}: the other {len(others)} records print {hashlib.sha256(chr(10).join(others).encode()).hexdigest()[:16]}")
' "$ZONE" "$DOMAIN"
