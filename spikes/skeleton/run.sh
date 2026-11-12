#!/usr/bin/env bash
# The end-to-end run: the behaviours of INTERFACE.md against the REAL Frappe half and the REAL Core half together.
#   spikes/skeleton/run.sh [slug] [--only B1,B6,...] [--list]        (slug default: acme)
# Needs anvil 8545, the Core stub 8787 and the Frappe stack 8000; it starts them if they are down (core/bin/up.sh,
# frappe/bin/up.sh). Re-running with a slug that exists continues: `org create` is idempotent, the per-run people and
# documents are created fresh. Throwaway; dev keys only.
# Every check has a stable name, <behaviour>.<what> (B3.ledger-posted). A check prints a human line (PASS/FAIL) and then
# one machine line, which tools/run-evals.ts reads:
#     @check<TAB>name<TAB>pass|fail<TAB>ms since the previous check<TAB>detail (one line, at most 300 characters)
# A name may repeat in a run (B7's four payments, PRIVACY's three sites); the runner folds the repeats. A check that is only
# ever a `bad` is a guard: it prints nothing when it holds, and fails the run when it does not.
# Exit code: non-zero on any FAIL.
# --only runs the named behaviours (B1..B9, PRIVACY, NAMES) and the behaviours they need to have run first: B1 always
# (the company and the sign-in), and the earlier ones whose people, documents and hats a behaviour uses (see `deps`). The
# checks of those run, print and count as well. --list prints every check name and whether it is a check or a guard.
# SKELETON_FRAPPE=<dir> names the frappe/ folder whose up.sh and down.sh start and stop the stack (default: this folder's),
# for a run of a copy of this script against a stack that was started from another checkout.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SLUG=acme; ONLY=""; LIST=""
while [ $# -gt 0 ]; do case "$1" in
  --only) ONLY="${2:-}"; shift 2;;
  --list) LIST=1; shift;;
  -*) echo "usage: run.sh [slug] [--only B1,B6,...] [--list]" >&2; exit 2;;
  *) SLUG="$1"; shift;;
esac; done
CHECK_DIR="$HERE/../../evals/checks"
STEPS=()
register() { STEPS+=("$1|$2|$3|${4:-}"); }
for file in "$CHECK_DIR"/*.sh; do . "$file"; done
if [ -n "$LIST" ]; then
  grep -ohE '(chk|ok|bad) [A-Z][A-Za-z0-9]*\.[a-z0-9.-]+' "$0" "$CHECK_DIR"/*.sh | awk '{k=($1=="bad")?"guard":"check"; if(!($2 in s)||k=="check")s[$2]=k} END{for(n in s)print n"\t"s[n]}' | sort
  exit 0
fi
WANTED=" "
include() {
  case "$WANTED" in *" $1 "*) return;; esac
  WANTED="$WANTED$1 "
  local order name fn needs dep entry
  for entry in "${STEPS[@]}"; do
    IFS='|' read -r order name fn needs <<< "$entry"
    if [ "$name" = "$1" ]; then for dep in $needs; do include "$dep"; done; fi
  done
}
include B1
for behaviour in ${ONLY//,/ }; do include "$behaviour"; done
want() { [ -z "$ONLY" ] || case "$WANTED" in *" $1 "*) true;; *) false;; esac; }
set -a; . "$HERE/.env"; set +a
SITE="$SLUG.localhost"; COMPANY="${COMPANY:-Acme Trading Ltd}"
STACK_FRAPPE="${SKELETON_FRAPPE:-$HERE/frappe}"
FR=http://127.0.0.1:8000; CORE=http://127.0.0.1:8787; RPC=http://127.0.0.1:8545
ADMIN=hannah@acme.test        # the org's admin hat and its founder (Companies House)
BUDGET=marcus@acme.test       # budget-holder, department Finance
PAYROLL=tomas@acme.test       # payroll-approver: Frappe roles, but the chain refuses his payments
SUPPLIER="Brightside Cleaning Ltd"; SUPPLIER_ADDR=0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc   # elena (test key)
DIRECT_TO=0x90F79bf6EB2c4f870365E785982E1f101E93b906                                              # priya (test key)
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT; pass=0; fail=0
ms() { python3 -c 'import time;print(int(time.time()*1000))'; }
LAST_MS=$(ms)
emit() { local now; now=$(ms); printf '@check\t%s\t%s\t%s\t%s\n' "$1" "$2" "$((now - LAST_MS))" "$(printf '%s' "$3" | tr '\t\n\r' '   ' | cut -c1-300)"; LAST_MS=$now; }
ok()  { echo "PASS $2"; pass=$((pass+1)); emit "$1" pass "$2"; }                       # ok  <name> <what held>
bad() { echo "FAIL $2 :: $3"; fail=$((fail+1)); emit "$1" fail "$2 :: $3"; }          # bad <name> <what> <why>
chk() { if [ "$3" = "$4" ]; then ok "$1" "$2${5:+ ($5)}"; else bad "$1" "$2" "expected [$4] got [$3]"; fi; }   # chk <name> <what> <got> <want> [detail]
info() { echo "INFO $*"; }
jget() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))' "$1" 2>/dev/null; }
CALLS="$T/calls"; : > "$CALLS"
core() { echo x >> "$CALLS"; node --experimental-strip-types --no-warnings "$HERE/core/src/main.ts" "$@"; }   # every call is counted: B8 compares with the record
export -f core; export CALLS HERE   # (the polling loops below run `core` inside bash -c)
fr() { local jar=$1; shift; curl -s -b "$jar" -H "X-Frappe-Site-Name: $SITE" -H 'Content-Type: application/json' "$@"; }
# list docs: lst <jar> <doctype> <filters json> <fields json> [order_by]
lst() { fr "$1" -G "$FR/api/resource/${2// /%20}" --data-urlencode "filters=$3" --data-urlencode "fields=$4" --data-urlencode "limit_page_length=200" ${5:+--data-urlencode "order_by=$5"}; }
# wait_for <seconds> <command...>: polls every 0.15 s; sets WAITED (ms); returns 1 on timeout
wait_for() { local lim=$1; shift; local t0; t0=$(ms); while ! "$@" >/dev/null 2>&1; do [ $(( $(ms) - t0 )) -gt $((lim*1000)) ] && { WAITED=$(( $(ms) - t0 )); return 1; }; sleep 0.15; done; WAITED=$(( $(ms) - t0 )); }
usdc() { cast call "$USDC" "balanceOf(address)(uint256)" "$1" --rpc-url "$RPC" | awk '{print $1}'; }
login_admin() {   # retries: right after a stack start or a site script the first logins can fail
  local i; for i in $(seq 1 40); do
    rm -f "$T/admin"; curl -s -c "$T/admin" -o /dev/null -H "X-Frappe-Site-Name: $SITE" -d usr=Administrator -d pwd="${CAPXUL_ADMIN_PASSWORD:-admin}" $FR/api/method/login
    [ "$(curl -s -b "$T/admin" -H "X-Frappe-Site-Name: $SITE" $FR/api/method/frappe.auth.get_logged_user | jget "d['message']")" = Administrator ] && return 0; sleep 1
  done; return 1; }
# The OAuth redirect chain, by hand: login page -> Core authorize (pick the person, the passkey stand-in) -> callback.
sso() {
  local email=$1 jar=$2 auth loc; rm -f "$jar"
  auth=$(curl -s -c "$jar" -b "$jar" -H "X-Frappe-Site-Name: $SITE" $FR/login | grep -o 'href="http://localhost:8787/oauth/authorize[^"]*"' | head -1 | sed 's/^href="//;s/"$//;s/&amp;/\&/g')
  [ -n "$auth" ] || return 1
  python3 -c 'import sys,urllib.parse as u; q=dict(u.parse_qsl(sys.argv[1].split("?",1)[1])); q["email"]=sys.argv[2]; print(u.urlencode(q))' "$auth" "$email" > "$jar.form"
  loc=$(curl -s -o /dev/null -w '%{redirect_url}' -d @"$jar.form" http://localhost:8787/oauth/authorize)
  [ -n "$loc" ] || return 1
  curl -s -o /dev/null -c "$jar" -b "$jar" -H "X-Frappe-Site-Name: $SITE" "${loc/http:\/\/$SITE:8000/$FR}"
  [ "$(fr "$jar" $FR/api/method/frappe.auth.get_logged_user | jget "d['message']")" = "$email" ]
}
roles_of() { fr "$T/admin" "$FR/api/resource/User/$1" | jget "sorted(r['role'] for r in d['data']['roles'] if r['role'] not in ('Desk User','All','Guest','Administrator'))"; }
has_roles() { [ "$(roles_of "$1")" = "$2" ]; }
dept_perm() { lst "$T/admin" "User Permission" "[[\"user\",\"=\",\"$1\"],[\"allow\",\"=\",\"Department\"]]" '["for_value"]' | jget "[p['for_value'] for p in d['data']]"; }
pe_field() { fr "$T/admin" "$FR/api/resource/Payment%20Entry/$1" | jget "d['data']['$2']"; }
pe_posted() { [ "$(pe_field "$1" docstatus)" = 1 ]; }
gl_of() { lst "$T/admin" "GL Entry" "[[\"voucher_no\",\"=\",\"$1\"],[\"is_cancelled\",\"=\",0]]" '["account","debit","credit"]'; }
pi_outstanding() { fr "$T/admin" "$FR/api/resource/Purchase%20Invoice/$1" | jget "d['data']['outstanding_amount']"; }
n_sent_events() { lst "$T/admin" "Capxul Chain Event" '[["kind","=","payment_sent"],["status","=","Applied"]]' '["name"]' | jget "len(d['data'])"; }
# A Purchase Invoice and a draft Payment Entry from the Safe, made over REST by the signed-in person: mk_pe <jar> <amount> -> "PI PE"
mk_pe() {
  local jar=$1 amt=$2 today pi pe body
  today=$(date +%F)
  body=$(python3 -c 'import json,sys; a=sys.argv; print(json.dumps({"supplier":a[1],"company":a[2],"posting_date":a[3],"due_date":a[3],"items":[{"item_name":"Office cleaning","description":"Office cleaning","qty":1,"rate":float(a[4]),"expense_account":a[5]}]}))' "$SUPPLIER" "$COMPANY" "$today" "$amt" "Administrative Expenses - $ABBR")
  pi=$(fr "$jar" -X POST $FR/api/resource/Purchase%20Invoice -d "$body" | jget "d['data']['name']")
  [ -n "$pi" ] || { echo ""; return 1; }
  fr "$jar" -X PUT "$FR/api/resource/Purchase%20Invoice/$pi" -d '{"docstatus":1}' >/dev/null
  fr "$jar" -G $FR/api/method/erpnext.accounts.doctype.payment_entry.payment_entry.get_payment_entry --data-urlencode "dt=Purchase Invoice" --data-urlencode "dn=$pi" --data-urlencode "bank_account=$SAFE_ACCOUNT" > "$T/pe.json"
  body=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1]))["message"]; d["paid_from"]=sys.argv[2]; d={k:v for k,v in d.items() if not k.startswith("__")}; print(json.dumps(d))' "$T/pe.json" "$SAFE_ACCOUNT")
  pe=$(fr "$jar" -X POST $FR/api/resource/Payment%20Entry -d "$body" | jget "d['data']['name']")
  [ -n "$pe" ] || return 1
  echo "$pi $pe"
}
# Ask the way the form's Submit does (capxul.api.request_payment); prints the answer JSON.
request() { fr "$1" -X POST $FR/api/method/capxul.api.request_payment -d "{\"name\":\"$2\"}"; }
approval_sign() { curl -s -X POST -H 'Accept: application/json' "$CORE/approve/$1/sign"; }
has_log() { grep -q "$1" "$HERE/core/state/core.log"; }

echo "== run.sh for org '$SLUG' ($SITE)"
"$HERE/core/bin/up.sh" >/dev/null 2>&1 || { bad PRE.core-up "prerequisite: anvil + Core stub" "core/bin/up.sh failed"; exit 2; }
"$STACK_FRAPPE/bin/up.sh" >/dev/null 2>&1 || { bad PRE.frappe-up "prerequisite: Frappe stack" "frappe/bin/up.sh failed"; exit 2; }
USDC=$(python3 -c "import json;print(json.load(open('$HERE/core/state/deployment.json'))['usdc'])")
PAYMENTS=$(python3 -c "import json;print(json.load(open('$HERE/core/state/deployment.json'))['payments'])")

while IFS='|' read -r order name fn needs; do
  if want "$name" || { [ "$name" = TL ] && want B9; }; then "$fn"; fi
done < <(printf '%s\n' "${STEPS[@]}" | sort -n)

echo; echo "RESULT: $pass passed, $fail failed  (site http://$SITE:8000, sign in as $ADMIN or $BUDGET through http://localhost:8787)"
[ $fail = 0 ]
