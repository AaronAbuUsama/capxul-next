#!/usr/bin/env bash
# The end-to-end run: the four behaviours of INTERFACE.md against the REAL Frappe half and the REAL Core half together.
#   spikes/skeleton/run.sh [slug]        (default: acme)
# Needs anvil 8545, the Core stub 8787 and the Frappe stack 8000; it starts them if they are down (core/bin/up.sh,
# frappe/bin/up.sh). Re-running with a slug that exists continues: `org create` is idempotent, the per-run people and
# documents are created fresh. Prints one PASS/FAIL line per check, exits non-zero on any FAIL. Throwaway; dev keys only.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
set -a; . "$HERE/.env"; set +a
SLUG="${1:-acme}"; SITE="$SLUG.localhost"; COMPANY="${COMPANY:-Acme Trading Ltd}"
FR=http://127.0.0.1:8000; CORE=http://127.0.0.1:8787; RPC=http://127.0.0.1:8545
ADMIN=hannah@acme.test        # the org's admin hat (chain: createOrg)
BUDGET=marcus@acme.test       # budget-holder, department Finance
PAYROLL=tomas@acme.test       # payroll-approver: Frappe roles, but the chain refuses his payments
SUPPLIER="Brightside Cleaning Ltd"; SUPPLIER_ADDR=0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc   # elena (test key)
DIRECT_TO=0x90F79bf6EB2c4f870365E785982E1f101E93b906                                              # priya (test key)
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok()  { echo "PASS $1"; pass=$((pass+1)); }
bad() { echo "FAIL $1 :: $2"; fail=$((fail+1)); }
chk() { if [ "$2" = "$3" ]; then ok "$1${4:+ ($4)}"; else bad "$1" "expected [$3] got [$2]"; fi; }
info() { echo "INFO $*"; }
ms() { python3 -c 'import time;print(int(time.time()*1000))'; }
jget() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))' "$1" 2>/dev/null; }
core() { node --experimental-strip-types --no-warnings "$HERE/core/src/main.ts" "$@"; }
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

# ---------------------------------------------------------------------------------------------------------------
echo "== run.sh for org '$SLUG' ($SITE)"
"$HERE/core/bin/up.sh" >/dev/null 2>&1 || { bad "prerequisite: anvil + Core stub" "core/bin/up.sh failed"; exit 2; }
"$HERE/frappe/bin/up.sh" >/dev/null 2>&1 || { bad "prerequisite: Frappe stack" "frappe/bin/up.sh failed"; exit 2; }
USDC=$(python3 -c "import json;print(json.load(open('$HERE/core/state/deployment.json'))['usdc'])")
PAYMENTS=$(python3 -c "import json;print(json.load(open('$HERE/core/state/deployment.json'))['payments'])")

echo "== Behaviour 1: an org is one command"
existed=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Frappe-Site-Name: $SITE" $FR/api/method/ping)
[ "$existed" = 200 ] && info "site $SITE already exists: org create continues idempotently (reuses the Safe, re-runs the site script)"
t0=$(ms); out=$(core org create "$SLUG" "$COMPANY" --admin $ADMIN 2>"$T/create.err"); rc=$?; create_ms=$(( $(ms) - t0 ))
[ $rc = 0 ] && ok "B1 org create exits 0 in $((create_ms/1000)) s" || { bad "B1 org create" "rc=$rc $(tail -c 400 "$T/create.err")"; exit 1; }
SAFE=$(echo "$out" | tail -1 | jget "d['safe']")
chk "B1 chain: the Safe on the chain is the one the site was given" "$(cast call "$PAYMENTS" "safeOf(bytes32)(address)" "$(cast keccak "$SLUG")" --rpc-url $RPC | tr 'A-F' 'a-f')" "$(echo "$SAFE" | tr 'A-F' 'a-f')" "$SAFE holds $(usdc "$SAFE") units of test USDC"
chk "B1 the site answers (by name, $SITE:8000)" "$(curl -s --resolve "$SITE:8000:127.0.0.1" http://$SITE:8000/api/method/ping | jget "d['message']")" pong
login_admin
ABBR=$(lst "$T/admin" Company '[]' '["name","abbr"]' | jget "d['data'][0]['abbr']")
chk "B1 the Company exists" "$(lst "$T/admin" Company '[]' '["name"]' | jget "'$COMPANY' in [c['name'] for c in d['data']]")" True
SAFE_ACCOUNT=$(fr "$T/admin" "$FR/api/method/frappe.client.get_single_value?doctype=Capxul%20Settings&field=safe_account" | jget "d['message']")
chk "B1 the Safe bank account exists, tied to the Safe address" "$(lst "$T/admin" "Bank Account" '[]' '["integration_id","account"]' | jget "[b['integration_id'].lower() for b in d['data'] if b['account']=='$SAFE_ACCOUNT']")" "['$(echo "$SAFE" | tr 'A-F' 'a-f')']" "$SAFE_ACCOUNT"
has_any_roles() { local r; r=$(roles_of "$1"); [ -n "$r" ] && [ "$r" != "[]" ]; }
if wait_for 30 has_any_roles $ADMIN; then ok "B1 the admin hat reached the site: the admin's User exists with roles ($(roles_of $ADMIN | cut -c1-60)...) ${WAITED}ms after org create returned"; else bad "B1 admin hat delivered" "no roles for $ADMIN"; fi
t0=$(ms); sso $ADMIN "$T/hannah"; rc=$?
chk "B1 admin completes the sign-in chain against the Core stub: session user is the admin" "$rc" 0 "$(( $(ms) - t0 ))ms"

echo "== Behaviour 2: roles follow hats"
core hat revoke "$SLUG" budget-holder $BUDGET --department Finance >/dev/null 2>&1 && { wait_for 15 has_roles $BUDGET "[]"; info "cleaned a leftover budget-holder grant from an earlier run"; }
out=$(core hat grant "$SLUG" budget-holder $BUDGET --department Finance 2>&1); rc=$?; t0=$(ms)
[ $rc = 0 ] && ok "B2 hat grant to a second person is on the chain" || bad "B2 hat grant" "$out"
WANT="['Accounts User', 'Expense Approver', 'Purchase User']"
if wait_for 10 has_roles $BUDGET "$WANT"; then ok "B2 mapped roles present $WAITED ms after the chain transaction was mined ($WANT)"; else bad "B2 roles follow the grant" "$(roles_of $BUDGET) after 10 s"; fi
chk "B2 the department limit exists (User Permission on Department)" "$([[ "$(dept_perm $BUDGET)" == "['Finance"* ]] && echo yes || echo no)" yes "$(dept_perm $BUDGET)"
code=$(fr "$T/admin" -o /dev/null -w '%{http_code}' -X PUT "$FR/api/resource/User/$BUDGET" -d '{"roles":[{"role":"System Manager"}]}')
chk "B2 a hand edit of roles through the REST API (as Administrator) is refused" "$code $(roles_of $BUDGET)" "403 $WANT"
out=$(core hat revoke "$SLUG" budget-holder $BUDGET --department Finance 2>&1); t0=$(ms)
if wait_for 10 has_roles $BUDGET "[]"; then ok "B2 hat revoke removes every role $WAITED ms after the chain transaction"; else bad "B2 revoke removes roles" "$(roles_of $BUDGET)"; fi
chk "B2 revoke removes the department limit" "$(dept_perm $BUDGET)" "[]"
core hat grant "$SLUG" budget-holder $BUDGET --department Finance >/dev/null 2>&1; wait_for 10 has_roles $BUDGET "$WANT"   # the payer for what follows

echo "== Behaviour 3: paying a document is the normal Frappe flow"
sso $ADMIN "$T/hannah" && sso $BUDGET "$T/marcus" || bad "B3 sign-in of the payer" "sso failed"
fr "$T/hannah" -X POST $FR/api/resource/Supplier -d "{\"supplier_name\":\"$SUPPLIER\",\"supplier_group\":\"All Supplier Groups\",\"capxul_wallet_address\":\"$SUPPLIER_ADDR\"}" > "$T/sup.json"
chk "B3 admin-hat person creates a supplier with a wallet address (their own session, not Administrator)" "$(fr "$T/hannah" "$FR/api/resource/Supplier/${SUPPLIER// /%20}" | jget "d['data']['capxul_wallet_address']")" "$SUPPLIER_ADDR"
read -r PI PE <<<"$(mk_pe "$T/marcus" 125.50)"
[ -n "${PE:-}" ] && ok "B3 budget-holder (session of $BUDGET) made Purchase Invoice $PI and a Payment Entry $PE from the Safe account" || { bad "B3 make invoice + payment entry" "$(tail -c 300 "$T/pe.json")"; exit 1; }
chk "B3 the invoice has 125.5 outstanding before paying" "$(pi_outstanding "$PI")" 125.5
ans=$(request "$T/marcus" "$PE"); APR=$(echo "$ans" | jget "d['message']['approval_url']"); APR=${APR##*/}
chk "B3 Submit asks Capxul: the entry shows waiting for a signature" "$(echo "$ans" | jget "d['message']['status']")" "Waiting for signature" "approval $APR"
chk "B3 still a draft while waiting" "$(pe_field "$PE" docstatus) $(pe_field "$PE" capxul_status)" "0 Waiting for signature"
B_TO=$(usdc $SUPPLIER_ADDR); B_SAFE=$(usdc "$SAFE")
t0=$(ms); res=$(approval_sign "$APR"); sign_ms=$(( $(ms) - t0 )); TX=$(echo "$res" | jget "d['txHash']")
chk "B3 sign in the Core stub pop-up sends the chain transaction (as $BUDGET's key)" "$(echo "$res" | jget "d['status']")" submitted "tx $TX in ${sign_ms}ms"
t0=$(ms); wait_for 30 pe_posted "$PE"; posted_ms=$(( $(ms) - t0 ))
chk "B3 the Payment Entry is submitted" "$(pe_field "$PE" docstatus)" 1 "${posted_ms}ms after the sign call returned"
chk "B3 the chain moved the test USDC: supplier +125.5, Safe -125.5" "$(( $(usdc $SUPPLIER_ADDR) - B_TO )) $(( B_SAFE - $(usdc "$SAFE") ))" "125500000 125500000"
chk "B3 the entry carries the transaction hash" "$(pe_field "$PE" reference_no | tr 'A-F' 'a-f')" "$(echo "$TX" | tr 'A-F' 'a-f')"
chk "B3 the ledger is posted (Safe account credited 125.5)" "$(gl_of "$PE" | jget "sum(g['credit'] for g in d['data'] if g['account']=='$SAFE_ACCOUNT')")" 125.5
chk "B3 the invoice has nothing outstanding" "$(pi_outstanding "$PI")" 0.0
PE_B3=$PE

echo "== Behaviour 4: it stays true when broken"
# (a) a person without the hat. payroll-approver gets Frappe roles that may submit a Payment Entry (a site-side map edit),
#     but the chain gives that hat no payment authority.
fr "$T/admin" "$FR/api/resource/Capxul%20Hat%20Map/payroll-approver" > "$T/map.json"
core hat revoke "$SLUG" payroll-approver $PAYROLL >/dev/null 2>&1 && wait_for 15 has_roles $PAYROLL "[]"
fr "$T/admin" -o /dev/null -X PUT "$FR/api/resource/Capxul%20Hat%20Map/payroll-approver" -d '{"roles":[{"role":"HR Manager"},{"role":"HR User"},{"role":"Accounts User"},{"role":"Purchase User"}]}'
core hat grant "$SLUG" payroll-approver $PAYROLL >/dev/null 2>&1; wait_for 10 has_roles $PAYROLL "['Accounts User', 'HR Manager', 'HR User', 'Purchase User']"
sso $PAYROLL "$T/tomas"
read -r PI4 PE4 <<<"$(mk_pe "$T/tomas" 80.00)"
[ -n "${PE4:-}" ] || bad "4a make the payroll-approver's payment entry" "$(tail -c 300 "$T/pe.json")"
ans=$(request "$T/tomas" "$PE4"); APR=$(echo "$ans" | jget "d['message']['approval_url']"); APR=${APR##*/}
B_TO=$(usdc $SUPPLIER_ADDR); res=$(approval_sign "$APR")
chk "4a signer without the payment hat: the chain refuses" "$(echo "$res" | jget "(d['status'], d['reason'])")" "('failed', 'NOT_AUTHORISED')"
wait_for 20 bash -c "[ \"\$(curl -s -b $T/admin -H 'X-Frappe-Site-Name: $SITE' $FR/api/resource/Payment%20Entry/$PE4 | python3 -c 'import json,sys; print(json.load(sys.stdin)[\"data\"][\"capxul_status\"])')\" != 'Waiting for signature' ]"
chk "4a the entry is not posted and shows why" "$(pe_field "$PE4" docstatus) $(pe_field "$PE4" capxul_status | cut -c1-22 | tr ' ' _) $(gl_of "$PE4" | jget "len(d['data'])")" "0 Failed:_NOT_AUTHORISED 0" "$(pe_field "$PE4" capxul_status)"
chk "4a no money moved" "$(( $(usdc $SUPPLIER_ADDR) - B_TO ))" 0
core hat revoke "$SLUG" payroll-approver $PAYROLL >/dev/null 2>&1; python3 - "$T/map.json" > "$T/map.put" <<'E'
import json,sys; d=json.load(open(sys.argv[1]))["data"]; print(json.dumps({"roles":[{"role":r["role"]} for r in d["roles"]]}))
E
wait_for 10 has_roles $PAYROLL "[]"; fr "$T/admin" -o /dev/null -X PUT "$FR/api/resource/Capxul%20Hat%20Map/payroll-approver" -d @"$T/map.put"

# (b) the same payment_sent twice
ev=$(lst "$T/admin" "Capxul Chain Event" '[["kind","=","payment_sent"]]' '["name","seq"]' "seq desc" | jget "(d['data'][0]['seq'], d['data'][0]['name'])")
SEQ=$(echo "$ev" | tr -d '(),' | awk '{print $1}')
n0=$(n_sent_events); gl0=$(gl_of "$PE_B3" | jget "len(d['data'])"); dup0=$(grep -c "seq $SEQ payment_sent already applied" "$HERE/core/state/core.log")
core events redeliver "$SLUG" "$SEQ" >/dev/null
wait_for 10 bash -c "[ \$(grep -c 'seq $SEQ payment_sent already applied' '$HERE/core/state/core.log') -gt $dup0 ]"
chk "4b Core delivered seq $SEQ (payment_sent) a second time and Frappe answered 'already applied'" "$(grep -c "seq $SEQ payment_sent already applied" "$HERE/core/state/core.log")" "$((dup0+1))"
chk "4b one posting: still 1 applied event, $gl0 ledger rows, entry submitted once" "$(n_sent_events) $(gl_of "$PE_B3" | jget "len(d['data'])") $(pe_field "$PE_B3" docstatus)" "$n0 $gl0 1"

# (c) Frappe is down when the log lands
read -r PI5 PE5 <<<"$(mk_pe "$T/marcus" 60.00)"
ans=$(request "$T/marcus" "$PE5"); APR=$(echo "$ans" | jget "d['message']['approval_url']"); APR=${APR##*/}
n0=$(n_sent_events); B_TO=$(usdc $SUPPLIER_ADDR)
"$HERE/frappe/bin/down.sh" >/dev/null 2>&1
res=$(approval_sign "$APR"); TX5=$(echo "$res" | jget "d['txHash']")
chk "4c signed while Frappe is down: the chain moved the money" "$(( $(usdc $SUPPLIER_ADDR) - B_TO ))" 60000000 "tx $TX5"
wait_for 10 bash -c "core() { node --experimental-strip-types --no-warnings $HERE/core/src/main.ts \"\$@\"; }; core events status $SLUG | grep -q 'pending=[1-9]'"
chk "4c Core holds the undelivered event in its outbox" "$(core events status "$SLUG" | head -1 | grep -o 'pending=[0-9]*')" "pending=1" "$(core events status "$SLUG" | sed -n 2p | cut -c1-90)"
t0=$(ms); "$HERE/frappe/bin/up.sh" >/dev/null 2>&1; up_ms=$(( $(ms) - t0 )); info "Frappe stack back up in $((up_ms/1000)) s"
login_admin; t0=$(ms); wait_for 90 pe_posted "$PE5"; ok_c=$?; posted_ms=$(( $(ms) - t0 ))
chk "4c after Frappe starts the entry posts with nobody re-sending by hand" "$(pe_field "$PE5" docstatus) $ok_c" "1 0" "${posted_ms}ms after the stack answered"
sleep 2
chk "4c exactly once: 1 new applied event, 2 ledger rows, Core outbox empty" "$(( $(n_sent_events) - n0 )) $(gl_of "$PE5" | jget "len(d['data'])") $(core events status "$SLUG" | head -1 | grep -o 'pending=[0-9]*')" "1 2 pending=0"

# (d) direct submit of a Safe-backed Payment Entry
code=$(fr "$T/admin" -o "$T/o" -w '%{http_code}' -X PUT "$FR/api/resource/Payment%20Entry/$PE4" -d '{"docstatus":1}')
chk "4d direct submit of a Safe-backed Payment Entry (REST, as Administrator) is refused, nothing posted" "$code $(pe_field "$PE4" docstatus) $(gl_of "$PE4" | jget "len(d['data'])")" "417 0 0"
code=$(fr "$T/marcus" -o /dev/null -w '%{http_code}' -X POST $FR/api/method/frappe.client.submit -d "{\"doc\":$(fr "$T/admin" "$FR/api/resource/Payment%20Entry/$PE4" | jget "__import__('json').dumps(d['data'])")}")
chk "4d the same through frappe.client.submit as the budget-holder is refused" "$code" 417

# (e) pay direct on the chain, no document
out=$(core pay direct "$SLUG" $DIRECT_TO 40 2>&1); TXD=$(echo "$out" | grep -o 'tx 0x[0-9a-f]*' | awk '{print $2}')
[ -n "$TXD" ] || bad "4e pay direct" "$out"
bt() { lst "$T/admin" "Bank Transaction" "[[\"transaction_id\",\"=\",\"$TXD\"]]" '["withdrawal","status","bank_account"]' | jget "[(b['withdrawal'], b['status']) for b in d['data']]"; }
wait_for 20 bash -c "[ \"\$(curl -s -b $T/admin -H 'X-Frappe-Site-Name: $SITE' -G $FR/api/resource/Bank%20Transaction --data-urlencode 'filters=[[\"transaction_id\",\"=\",\"$TXD\"]]' | python3 -c 'import json,sys; print(len(json.load(sys.stdin)[\"data\"]))')\" = 1 ]"
chk "4e a chain payment with no document is an unreconciled Bank Transaction" "$(bt)" "[(40.0, 'Unreconciled')]" "tx $TXD"

# (f) Administrator is not a person on the chain: it cannot ask for a payment (Core cannot map it to a signer)
out=$(request "$T/admin" "$PE4"); chk "4f Administrator asking for a payment is refused with the reason, nothing sent" "$(echo "$out" | jget "'not a person Capxul knows' in d['exception']") $(pe_field "$PE4" docstatus)" "True 0" "$(echo "$out" | jget "d['exception'][:150]")"

# (g) an event the site cannot apply must not block the org's later events: a hat granted to an address Core has no email for
UNKNOWN=$(python3 -c 'import secrets;print("0x"+secrets.token_hex(20))'); HATS=$(python3 -c "import json;print(json.load(open('$HERE/core/state/deployment.json'))['hats'])")
HK=$(python3 -c "import json;print([p for p in json.load(open('$HERE/core/people.json'))['people'] if p['email']=='$ADMIN'][0]['privateKey'])")   # anvil's published test key
cast send "$HATS" "grant(bytes32,string,address,string)" "$(cast keccak "$SLUG")" member "$UNKNOWN" "" --private-key "$HK" --rpc-url $RPC >/dev/null 2>&1
t0=$(ms); wait_for 30 bash -c "node --experimental-strip-types --no-warnings $HERE/core/src/main.ts events status $SLUG | head -1 | grep -q 'pending=0'"
chk "4g poison event: Core's outbox drains (the unappliable event is parked, not retried for ever)" "$(core events status "$SLUG" | head -1 | grep -o 'pending=[0-9]*')" "pending=0" "$((WAITED))ms"
chk "4g the parked event is visible on the site with its reason" "$(lst "$T/admin" "Capxul Chain Event" '[["status","=","Parked"]]' '["error"]' | jget "'has no person_email' in d['data'][-1]['error']")" True
core hat grant "$SLUG" member jonas@acme.test >/dev/null 2>&1; wait_for 15 has_roles jonas@acme.test "['Employee']"
chk "4g a hat granted after the poison event still reaches the site" "$(roles_of jonas@acme.test)" "['Employee']" "${WAITED}ms"
core hat revoke "$SLUG" member jonas@acme.test >/dev/null 2>&1

echo "== Behaviour 5: parts of the product are switched from the CLI"
sitedb() { ( . "$HERE/frappe/bin/lib.sh"; inbench "bench --site $SITE execute $1 --kwargs '$2'" 2>/dev/null | tail -1 ); }
fcount() { sitedb capxul.features.count "{\"doctype\":\"$1\"}"; }
feat() { core feature list "$SLUG" | awk '$1=="'"$1"'"{print $2}'; }
desk_has() {   # desk_has <jar> <module>: does the person's desk (the boot data) still list the module
  curl -s -L -b "$1" -H "X-Frappe-Site-Name: $SITE" $FR/desk | python3 -c '
import json,sys
h=sys.stdin.read(); i=h.index("frappe.boot = ")+14
b,_=json.JSONDecoder().raw_decode(h[i:]); print(sys.argv[1] in b.get("module_sidebars",{}))' "$2"; }
code_of() { local jar=$1; shift; fr "$jar" -o /dev/null -w '%{http_code}' "$@"; }
core feature off "$SLUG" whatsapp --as $ADMIN >/dev/null 2>&1; core feature on "$SLUG" crm --as $ADMIN >/dev/null 2>&1; core feature on "$SLUG" projects --as $ADMIN >/dev/null 2>&1
chk "B5 feature list shows the defaults on the site" "$(core feature list "$SLUG" | awk 'NR>1{printf "%s=%s ", $1, $2}')" "accounts=on people=on payroll=on projects=on crm=on whatsapp=off stock=off manufacturing=off "
chk "B5 the same state is readable from the site itself (REST, as the admin-hat person)" "$(fr "$T/hannah" "$FR/api/method/capxul.features.status" | jget "d['message']['features']['crm']+d['message']['features']['whatsapp']")" onoff
out=$(core feature off "$SLUG" projects --as $BUDGET 2>&1); rc=$?
chk "B5 a person without the admin hat is refused, with the reason" "$rc $(echo "$out" | grep -c 'does not wear the admin hat') $(feat projects)" "1 1 on"
# projects: a record, then off. (Two sessions for the same person: opening the desk gives a session a CSRF token, after which
# a bare curl POST is refused 400, so the desk and /crm page checks use their own session.)
sso $ADMIN "$T/hannah"; sso $ADMIN "$T/hannahd"
fr "$T/hannah" -X POST $FR/api/resource/Project -d "{\"project_name\":\"B5 Project $(date +%s)\"}" >/dev/null
PNAME=$(lst "$T/hannah" Project '[]' '["name"]' | jget "d['data'][0]['name']")
P0=$(fcount Project); [ -n "$P0" ] && [ "$P0" -ge 1 ] 2>/dev/null && ok "B5 a Project exists before switching ($P0 in the database)" || bad "B5 a Project exists" "count=[$P0]"
chk "B5 before off: the admin-hat person reads Projects over REST and has them on the desk" "$(code_of "$T/hannah" "$FR/api/resource/Project") $(desk_has "$T/hannahd" Projects)" "200 True"
t0=$(ms); core feature off "$SLUG" projects --as $ADMIN >/dev/null 2>"$T/off.err"; rc=$?; off_ms=$(( $(ms) - t0 ))
chk "B5 feature off projects by the admin" "$rc $(feat projects)" "0 off" "${off_ms}ms"
chk "B5 off: Project is unreachable over REST for the admin-hat person (list, read one, create, client.get_list)" "$(code_of "$T/hannah" "$FR/api/resource/Project") $(code_of "$T/hannah" "$FR/api/resource/Project/$PNAME") $(code_of "$T/hannah" -X POST "$FR/api/resource/Project" -d '{"project_name":"nope"}') $(code_of "$T/hannah" -G "$FR/api/method/frappe.client.get_list" --data-urlencode doctype=Project)" "403 403 403 403"
chk "B5 off: also refused for Administrator over REST (the guard does not look at who)" "$(code_of "$T/admin" "$FR/api/resource/Project")" 403
chk "B5 off: Projects is gone from the person's desk" "$(desk_has "$T/hannahd" Projects)" False
chk "B5 off: the records are still in the database (bench-side count)" "$(fcount Project)" "$P0"
core feature on "$SLUG" projects --as $ADMIN >/dev/null 2>&1
chk "B5 on again: REST answers, the desk shows Projects, the same records are there" "$(code_of "$T/hannah" "$FR/api/resource/Project") $(desk_has "$T/hannahd" Projects) $(lst "$T/hannah" Project '[]' '["name"]' | jget "len(d['data'])")" "200 True $P0"
# crm and whatsapp
out=$(core feature off "$SLUG" crm --as $ADMIN 2>&1); chk "B5 crm off: Frappe CRM's /crm and its API answer 403 for the admin-hat person" "$(code_of "$T/hannahd" $FR/crm) $(code_of "$T/hannah" "$FR/api/method/crm.api.session.get_users") $(code_of "$T/hannah" "$FR/api/resource/CRM%20Deal")" "403 403 403"
out=$(core feature on "$SLUG" whatsapp --as $ADMIN 2>&1); rc=$?
chk "B5 whatsapp on while crm is off is refused with the reason, nothing installed or changed" "$rc $(echo "$out" | grep -c 'needs crm') $(feat whatsapp)" "1 1 off"
core feature on "$SLUG" crm --as $ADMIN >/dev/null 2>&1
core hat grant "$SLUG" member jonas@acme.test >/dev/null 2>&1; wait_for 15 has_roles jonas@acme.test "['Employee']"; sso jonas@acme.test "$T/jonas"
chk "B5 crm on: the CRM screens answer for the admin-hat person (the page and its API)" "$(code_of "$T/hannahd" $FR/crm) $(code_of "$T/hannah" "$FR/api/method/crm.api.session.get_users") $(desk_has "$T/hannahd" FCRM)" "200 200 True"
chk "B5 ... and not for a person with only the member hat" "$(code_of "$T/jonas" $FR/crm) $(code_of "$T/jonas" "$FR/api/method/crm.api.session.get_users")" "403 403"
# a won deal becomes a Customer (configuration only: ERPNext CRM Settings)
ORG="Gamma $(date +%s) Ltd"
fr "$T/hannah" -X POST $FR/api/resource/CRM%20Organization -d "{\"organization_name\":\"$ORG\"}" >/dev/null
DEAL=$(fr "$T/hannah" -X POST $FR/api/resource/CRM%20Deal -d "{\"organization\":\"$ORG\",\"status\":\"Qualification\",\"lead_name\":\"Gina Gamma\",\"deal_value\":12000,\"currency\":\"USD\"}" | jget "d['data']['name']")
fr "$T/hannah" -X PUT "$FR/api/resource/CRM%20Deal/$DEAL" -d '{"status":"Won"}' >/dev/null
chk "B5 a deal moved to Won becomes an ERPNext Customer carrying the deal's name, type and back-reference" "$(fr "$T/hannah" "$FR/api/resource/Customer/${ORG// /%20}" | jget "(d['data']['customer_type'], d['data']['crm_deal']=='$DEAL')") $(fr "$T/hannah" "$FR/api/resource/CRM%20Deal/$DEAL" | jget "d['data']['erpnext_customer']==\"$ORG\"")" "('Company', True) True"
t0=$(ms); core feature on "$SLUG" whatsapp --as $ADMIN >/dev/null 2>"$T/wa.err"; rc=$?; wa_ms=$(( $(ms) - t0 ))
chk "B5 whatsapp on (crm on): installs the app if needed; it is on and answers as not configured (no credentials)" "$rc $(feat whatsapp) $(fr "$T/hannah" "$FR/api/method/crm.api.whatsapp.is_whatsapp_installed" | jget "d['message']") $(fr "$T/hannah" "$FR/api/method/crm.api.whatsapp.is_whatsapp_enabled" | jget "d['message']")" "0 on True False" "${wa_ms}ms"
core feature off "$SLUG" whatsapp --as $ADMIN >/dev/null 2>&1
chk "B5 a feature cannot be switched by hand on the site (REST PUT as Administrator is refused)" "$(code_of "$T/admin" -X PUT "$FR/api/resource/Capxul%20Feature/stock" -d '{"enabled":1}') $(feat stock)" "403 off"
core hat revoke "$SLUG" member jonas@acme.test >/dev/null 2>&1

echo "== Names: the site says Capxul, not Frappe or ERPNext (measured, not asserted)"
t0=$(ms); "$HERE/frappe/bin/find-names.sh" "$SLUG" $ADMIN jonas@acme.test > "$T/names.txt" 2>&1; names_ms=$(( $(ms) - t0 ))
FOUND=$(grep '^FOUND' "$T/names.txt" | tail -1)
if [ -n "$FOUND" ]; then ok "NAMES crawl as admin-hat and member-hat people finished in $((names_ms/1000)) s: $FOUND (shown = text a person reads; kept = copyright notice and third-party product names; covered = replaced by the person's own translations; internal = identifiers)"; else bad "NAMES crawl" "$(tail -c 300 "$T/names.txt")"; fi
grep -E '^(SHOWN|kept)' "$T/names.txt" | cut -c1-200 | while read -r l; do info "$l"; done

echo; echo "RESULT: $pass passed, $fail failed  (site http://$SITE:8000, sign in as $ADMIN or $BUDGET through http://localhost:8787)"
[ $fail = 0 ]
