#!/usr/bin/env bash
# Shows that nothing of this stack is left in the Cloudflare account or the Neon organization.
# It counts everything, and names only what starts with this stack's name. Usage: ./check-clean.sh
set -euo pipefail
cd "$(dirname "$0")"
cf="https://api.cloudflare.com/client/v4/accounts/$(curl -sS 'https://api.cloudflare.com/client/v4/accounts?per_page=5' | python3 -c "import json,sys; print(json.load(sys.stdin)['result'][0]['id'])")"
org="$(curl -sS https://console.neon.tech/api/v2/users/me/organizations | python3 -c "import json,sys; print(json.load(sys.stdin)['organizations'][0]['id'])")"
count() { # count <label> <python expression giving the list of names from d>
  python3 -c "
import json,sys
d=json.load(sys.stdin); names=[n for n in ($2) if n]
mine=[n for n in names if n.lower().startswith('capxulspikecontainers')]
print(f'$1: {len(names)} in the account, {len(mine)} of this stack', mine)"
}
curl -sS "$cf/workers/scripts" | count "workers" "[s['id'] for s in d['result']]"
curl -sS "$cf/containers/applications" | count "container applications" "[a['name'] for a in d['result']]"
curl -sS "$cf/workers/durable_objects/namespaces?per_page=1000" | count "durable object namespaces" "[n.get('script') for n in d['result']]"
curl -sS "$cf/r2/buckets?per_page=1000" | count "r2 buckets" "[b['name'] for b in d['result']['buckets']]"
curl -sS "https://console.neon.tech/api/v2/projects?org_id=$org&limit=400" | count "neon projects" "[p['name'] for p in d['projects']]"
python3 registry.py
