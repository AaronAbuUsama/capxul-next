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

# ---------------------------------------------------------------------------------------------------------------
echo "== run.sh for org '$SLUG' ($SITE)"
"$HERE/core/bin/up.sh" >/dev/null 2>&1 || { bad "prerequisite: anvil + Core stub" "core/bin/up.sh failed"; exit 2; }
"$HERE/frappe/bin/up.sh" >/dev/null 2>&1 || { bad "prerequisite: Frappe stack" "frappe/bin/up.sh failed"; exit 2; }
USDC=$(python3 -c "import json;print(json.load(open('$HERE/core/state/deployment.json'))['usdc'])")
PAYMENTS=$(python3 -c "import json;print(json.load(open('$HERE/core/state/deployment.json'))['payments'])")

REC="$HERE/core/state/record/main.jsonl"; REC0=$( [ -f "$REC" ] && wc -l < "$REC" || echo 0 ); REC0=$((REC0))
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
wait_for 10 bash -c "core events status $SLUG | grep -q 'pending=[1-9]'"
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
t0=$(ms); wait_for 30 bash -c "core events status $SLUG | head -1 | grep -q 'pending=0'"
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

# ---------------------------------------------------------------------------------------------------------------
echo "== Behaviour 6: the door (the CLI reaches Frappe as the calling person; their own permissions decide)"
SALES=sam@acme.test; HR=sana@acme.test; PROJ=pavel@acme.test; RUN=$(date +%s)
WORLD=""   # set to another world's name to drive that world (B9)
dj() { core "$@" ${WORLD:+--world $WORLD} --json; }   # a door command's JSON answer
for pair in "sales $SALES" "hr-manager $HR" "project-manager $PROJ"; do set -- $pair; core hat grant "$SLUG" "$1" "$2" >/dev/null 2>&1; done
wait_for 30 has_roles $SALES "['Accounts User', 'Sales Manager', 'Sales User']"; wait_for 30 has_roles $HR "['Employee', 'HR Manager', 'HR User']"; wait_for 30 has_roles $PROJ "['Employee', 'Projects Manager', 'Projects User']"
chk "B6 three new hats (sales, hr-manager, project-manager) reached the site as roles" "$(roles_of $SALES | tr -d "'[] ,")$(roles_of $HR | tr -d "'[] ,")$(roles_of $PROJ | tr -d "'[] ,")" "AccountsUserSalesManagerSalesUserEmployeeHRManagerHRUserEmployeeProjectsManagerProjectsUser"
t0=$(ms); out=$(dj doc types $SLUG --as $ADMIN); ms_types=$(( $(ms) - t0 ))
NTYPES=$(echo "$out" | jget "d['data']['count']"); NDOC=$(echo "$out" | jget "len([t for t in d['data']['types'] if not t['child'] and not t['single']])")
[ "${NTYPES:-0}" -gt 100 ] && ok "B6 discovery: the admin-hat person reaches $NTYPES document types on a default site ($NDOC listable, ${ms_types}ms), from Frappe's own metadata" || bad "B6 doc types" "$out"
chk "B6 discovery by feature: crm lists its own types for the sales person" "$(dj doc types $SLUG --as $SALES --feature crm | jget "sorted(t['doctype'] for t in d['data']['types'] if t['doctype'] in ('CRM Lead','CRM Deal','CRM Organization'))")" "['CRM Deal', 'CRM Lead', 'CRM Organization']"
chk "B6 discovery: a schema comes from Frappe's metadata (CRM Lead has first_name, status)" "$(dj doc schema $SLUG "CRM Lead" --as $SALES | jget "all(f in [x['fieldname'] for x in d['data']['fields']] for f in ('first_name','status'))")" True
# sales: lead -> deal -> won -> customer in accounts -> invoice -> submit
LEAD=$(dj doc create $SLUG "CRM Lead" --as $SALES --data "{\"first_name\":\"Lena\",\"last_name\":\"Lead $RUN\",\"email\":\"lena$RUN@lead.test\",\"organization\":\"Lead Co $RUN\"}" | jget "d['data']['name']")
DEAL=$(dj doc call $SLUG crm.fcrm.doctype.crm_lead.crm_lead.convert_to_deal --as $SALES --args "{\"lead\":\"$LEAD\"}" | jget "d['data']")
[ -n "$LEAD" ] && [ -n "$DEAL" ] && ok "B6 sales person made lead $LEAD and converted it to deal $DEAL" || bad "B6 lead to deal" "lead=[$LEAD] deal=[$DEAL]"
dj doc update $SLUG "CRM Deal" "$DEAL" --as $SALES --data '{"status":"Won"}' >/dev/null
chk "B6 deal won: the customer is in accounts (read by the sales person)" "$(dj doc list $SLUG Customer --as $SALES --filters "[[\"crm_deal\",\"=\",\"$DEAL\"]]" --fields name,customer_type | jget "[(r['name'], r['customer_type']) for r in d['data']['rows']]")" "[('Lead Co $RUN', 'Company')]"
SI=$(dj doc create $SLUG "Sales Invoice" --as $SALES --data "{\"customer\":\"Lead Co $RUN\",\"company\":\"$COMPANY\",\"items\":[{\"item_name\":\"Consulting\",\"description\":\"Consulting\",\"qty\":1,\"rate\":900,\"income_account\":\"Sales - $ABBR\"}]}" | jget "d['data']['name']")
dj doc submit $SLUG "Sales Invoice" "$SI" --as $SALES >/dev/null
chk "B6 sales person made and submitted Sales Invoice $SI; it is in the ledger (Debtors debited 900)" "$(dj doc get $SLUG "Sales Invoice" "$SI" --as $SALES | jget "d['data']['docstatus']") $(lst "$T/admin" "GL Entry" "[[\"voucher_no\",\"=\",\"$SI\"],[\"is_cancelled\",\"=\",0]]" '["account","debit"]' | jget "sum(g['debit'] for g in d['data'] if g['account'].startswith('Debtors'))")" "1 900.0"
# HR: employee, leave application, approve
EMP=$(dj doc create $SLUG Employee --as $HR --data "{\"first_name\":\"Eva\",\"last_name\":\"Employee $RUN\",\"gender\":\"Female\",\"date_of_birth\":\"1992-04-04\",\"date_of_joining\":\"2026-01-05\",\"company\":\"$COMPANY\",\"status\":\"Active\"}" | jget "d['data']['name']")
[ "$(dj doc list $SLUG "Holiday List Assignment" --as $HR | jget "d['data']['count']")" = 0 ] && { dj doc create $SLUG "Holiday List" --as $HR --data "{\"holiday_list_name\":\"Acme $RUN\",\"from_date\":\"2026-01-01\",\"to_date\":\"2026-12-31\"}" >/dev/null; HLA=$(dj doc create $SLUG "Holiday List Assignment" --as $HR --data "{\"applicable_for\":\"Company\",\"assigned_to\":\"$COMPANY\",\"holiday_list\":\"Acme $RUN\",\"from_date\":\"2026-01-01\"}" | jget "d['data']['name']"); dj doc submit $SLUG "Holiday List Assignment" "$HLA" --as $HR >/dev/null; }
LA=$(dj doc create $SLUG "Leave Application" --as $HR --data "{\"employee\":\"$EMP\",\"leave_type\":\"Leave Without Pay\",\"from_date\":\"2026-11-16\",\"to_date\":\"2026-11-17\",\"company\":\"$COMPANY\",\"status\":\"Open\"}" | jget "d['data']['name']")
dj doc update $SLUG "Leave Application" "$LA" --as $HR --data '{"status":"Approved"}' >/dev/null; dj doc submit $SLUG "Leave Application" "$LA" --as $HR >/dev/null
chk "B6 HR person made employee $EMP and leave application $LA, approved it (submitted, status Approved)" "$(dj doc get $SLUG "Leave Application" "$LA" --as $HR | jget "(d['data']['docstatus'], d['data']['status'])")" "(1, 'Approved')"
# projects: project, task, timesheet
TSDATE=$(python3 -c "import datetime,sys; print(datetime.date(2025,1,1)+datetime.timedelta(days=int(sys.argv[1])%400))" $RUN)
PRJ=$(dj doc create $SLUG Project --as $PROJ --data "{\"project_name\":\"B6 Website $RUN\"}" | jget "d['data']['name']")
TSK=$(dj doc create $SLUG Task --as $PROJ --data "{\"subject\":\"Design\",\"project\":\"$PRJ\"}" | jget "d['data']['name']")
TS=$(dj doc create $SLUG Timesheet --as $PROJ --data "{\"company\":\"$COMPANY\",\"time_logs\":[{\"activity_type\":\"Planning\",\"from_time\":\"$TSDATE 09:00:00\",\"hours\":2,\"project\":\"$PRJ\",\"task\":\"$TSK\"}]}" | jget "d['data']['name']")
[ -n "$PRJ" ] && [ -n "$TSK" ] && [ -n "$TS" ] && ok "B6 project person made project $PRJ, task $TSK and timesheet $TS" || bad "B6 projects" "$PRJ/$TSK/$TS"
# reports
GLF="{\"company\":\"$COMPANY\",\"from_date\":\"2026-01-01\",\"to_date\":\"2026-12-31\"}"   # (a variable: macOS bash 3.2 mis-parses \" inside nested $( ) )
chk "B6 reports: the admin-hat person runs General Ledger and Trial Balance (rows come back)" "$(dj report run $SLUG "General Ledger" --as $ADMIN --filters "$GLF" | jget "d['data']['count']>5") $(dj report run $SLUG "Trial Balance" --as $ADMIN --filters "{\"company\":\"$COMPANY\",\"fiscal_year\":\"2026\",\"from_date\":\"2026-01-01\",\"to_date\":\"2026-12-31\"}" | jget "d['data']['count']>3") $(dj report list $SLUG --as $ADMIN | jget "d['data']['count']>50")" "True True True"
# refusals: a person without the role is refused, with a reason
refused() { local code; code=$(echo "$1" | jget "d['error']['code'] if not d['ok'] else 'OK'"); echo "$code"; }
chk "B6 refused with a reason: budget-holder creating a CRM Lead, sales person creating an Employee, HR person creating a Sales Invoice, project person running the General Ledger" "$(refused "$(dj doc create $SLUG "CRM Lead" --as $BUDGET --data '{"first_name":"x"}')") $(refused "$(dj doc create $SLUG Employee --as $SALES --data '{"first_name":"x"}')") $(refused "$(dj doc create $SLUG "Sales Invoice" --as $HR --data '{"customer":"x"}')") $(refused "$(dj report run $SLUG "General Ledger" --as $PROJ --filters "$GLF")")" "FORBIDDEN FORBIDDEN FORBIDDEN FORBIDDEN"
chk "B6 a known person with no hat on this site (elena) has no door: NO_HAT; Administrator is not a person: UNKNOWN_PERSON" "$(refused "$(dj doc list $SLUG Customer --as elena@brightside.test)") $(refused "$(dj doc list $SLUG Customer --as Administrator)")" "NO_HAT UNKNOWN_PERSON"
chk "B6 a door command with no --as is refused (the door never acts as Administrator)" "$(refused "$(dj doc list $SLUG Customer)")" NEEDS_PERSON
core feature off "$SLUG" projects --as $ADMIN >/dev/null 2>&1
off=$(dj doc list $SLUG Project --as $PROJ); offt=$(dj doc types $SLUG --as $PROJ --feature projects)
chk "B6 a switched-off feature is refused through the door, with the feature's name in the reason" "$(echo "$off" | jget "(d['error']['code'], 'projects' in d['error']['reason'])") $(refused "$offt")" "('FEATURE_OFF', True) FEATURE_OFF"
core feature on "$SLUG" projects --as $ADMIN >/dev/null 2>&1
chk "B6 ... and switched on again it answers" "$(dj doc list $SLUG Project --as $PROJ | jget "d['ok']")" True
nx=$(dj doc next $SLUG "Sales Invoice" "$SI" --as $SALES); info "doc next: $(echo "$nx" | jget "(len(d['data']['connections']), len(d['data']['makers']))") (connections, make-methods) for a Sales Invoice"
t0=$(ms); core doc list $SLUG Customer --as $SALES --limit 5 >/dev/null; info "timing: doc list $(( $(ms) - t0 )) ms wall (node start included)"
t0=$(ms); core doc create $SLUG Project --as $PROJ --data "{\"project_name\":\"B6 timing $RUN\"}" >/dev/null; info "timing: doc create $(( $(ms) - t0 )) ms wall"

# ---------------------------------------------------------------------------------------------------------------
echo "== Behaviour 7: the clock (a world's time is set and moved from the CLI; the chain and every site in it follow)"
wd() { core world clock show ${WORLD:-main} --json | jget "d['data']['time'][:10]"; }
mkpay() {   # mkpay <amount> [world]: sales invoice, purchase invoice, Safe payment entry, submit, sign by key. Prints "PE TX".
  local wdate si pi pe apr tx
  wdate=$(wd)
  dj doc create $SLUG "Sales Invoice" --as $SALES --data "{\"customer\":\"Lead Co $RUN\",\"company\":\"$COMPANY\",\"items\":[{\"item_name\":\"Retainer\",\"description\":\"Retainer\",\"qty\":1,\"rate\":100,\"income_account\":\"Sales - $ABBR\"}]}" > "$T/si.json"
  si=$(jget "d['data']['name']" < "$T/si.json"); dj doc submit $SLUG "Sales Invoice" "$si" --as $SALES >/dev/null
  pi=$(dj doc create $SLUG "Purchase Invoice" --as $BUDGET --data "{\"supplier\":\"$SUPPLIER\",\"company\":\"$COMPANY\",\"posting_date\":\"$wdate\",\"due_date\":\"$wdate\",\"items\":[{\"item_name\":\"Office cleaning\",\"description\":\"Office cleaning\",\"qty\":1,\"rate\":$1,\"expense_account\":\"Administrative Expenses - $ABBR\"}]}" | jget "d['data']['name']")
  dj doc submit $SLUG "Purchase Invoice" "$pi" --as $BUDGET >/dev/null
  dj doc call $SLUG erpnext.accounts.doctype.payment_entry.payment_entry.get_payment_entry --as $BUDGET --args "{\"dt\":\"Purchase Invoice\",\"dn\":\"$pi\",\"bank_account\":\"$SAFE_ACCOUNT\"}" > "$T/pe.json"
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1]))["data"]; d["paid_from"]=sys.argv[2]; print(json.dumps({k:v for k,v in d.items() if not k.startswith("__")}))' "$T/pe.json" "$SAFE_ACCOUNT" > "$T/pe.data"
  pe=$(dj doc create $SLUG "Payment Entry" --as $BUDGET --data @"$T/pe.data" | jget "d['data']['name']")
  apr=$(dj doc submit $SLUG "Payment Entry" "$pe" --as $BUDGET | jget "d['data']['approval']")
  dj approval sign $SLUG "$apr" --as $BUDGET > "$T/sign.json"; tx=$(jget "d['data']['txHash']" < "$T/sign.json")
  echo "$si $pi $pe $tx"
}
core hat grant "$SLUG" budget-holder $BUDGET >/dev/null 2>&1
chk "B7 a person who is not the world's admin cannot move its clock (refused, nothing changed)" "$(refused "$(dj world clock set main 2026-03-02T09:00:00Z --as $ADMIN)")" NOT_WORLD_ADMIN
t0=$(ms); out=$(dj world clock set main 2026-03-02T09:00:00Z --as operator); set_ms=$(( $(ms) - t0 ))
chk "B7 world clock set to 2 March 2026 (in the past): every site and the chain show it" "$(dj world clock show main | jget "(d['data']['time'][:10], d['data']['chainLatestBlock'][:10], sorted(set(s['today'] for s in d['data']['sites'])))")" "('2026-03-02', '2026-03-02', ['2026-03-02'])" "${set_ms}ms"
for old in $(dj doc list $SLUG "Accounting Period" --as $ADMIN --filters '[["start_date","=","2026-03-01"]]' | jget "' '.join(r['name'] for r in d['data']['rows'])"); do dj doc delete $SLUG "Accounting Period" "$old" --as $ADMIN >/dev/null; done   # a period left by an earlier run
PERIODS=("2026-03-02")
pay_at() { read -r si pi pe tx <<<"$(mkpay "$1")"; PES+=("$pe"); TXS+=("$tx"); SIS+=("$si"); [ -n "$tx" ] && ok "B7 $(wd): invoice $si, bill $pi, payment $pe signed by key through approval sign, tx $tx" || bad "B7 payment at $(wd)" "no tx: $(cat "$T/sign.json" | head -c 300)"; }
PES=(); TXS=(); SIS=()
pay_at 101.00
for step in 10d 10d 9d; do
  t0=$(ms); out=$(dj world clock advance main $step --as operator); adv_ms=$(( $(ms) - t0 )); PERIODS+=("$(wd)")
  [ "$(echo "$out" | jget "d['ok']")" = True ] || bad "B7 advance $step" "$(echo "$out" | head -c 300)"
  info "B7 advanced $step in ${adv_ms}ms: $(echo "$out" | jget "(d['data']['stopsPerSite'], d['data']['jobsRun'])") (stops per site, scheduled jobs run)"
  pay_at $((100 + ${#PES[@]})).50
done
chk "B7 the world is at 31 March after three advances; every site of the world and the chain agree" "$(dj world clock show main | jget "(d['data']['time'][:10], d['data']['chainLatestBlock'][:10], sorted(set(s['today'] for s in d['data']['sites'])), len(d['data']['sites'])>=3)")" "('2026-03-31', '2026-03-31', ['2026-03-31'], True)"
chk "B7 the ledger's dates are the world's dates: each payment and each sales invoice posted on the day the world was at" "$(lst "$T/admin" "GL Entry" "[[\"voucher_no\",\"in\",$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "${PES[@]}" "${SIS[@]}")],[\"is_cancelled\",\"=\",0]]" '["voucher_type","posting_date"]' | jget "sorted(set((g['voucher_type'],g['posting_date']) for g in d['data']))")" "[('Payment Entry', '2026-03-02'), ('Payment Entry', '2026-03-12'), ('Payment Entry', '2026-03-22'), ('Payment Entry', '2026-03-31'), ('Sales Invoice', '2026-03-02'), ('Sales Invoice', '2026-03-12'), ('Sales Invoice', '2026-03-22'), ('Sales Invoice', '2026-03-31')]"
blocks=""; for tx in "${TXS[@]}"; do n=$(cast receipt "$tx" blockNumber --rpc-url $RPC); blocks+="$(date -u -r "$(cast block "$n" -f timestamp --rpc-url $RPC)" +%F) "; done
chk "B7 the chain's block times agree: each payment's block carries the world's date" "$blocks" "2026-03-02 2026-03-12 2026-03-22 2026-03-31 "
chk "B7 the payment entries took their reference date from the block (chain time, not host time)" "$(for pe in "${PES[@]}"; do pe_field "$pe" reference_date; done | tr '\n' ' ')" "2026-03-02 2026-03-12 2026-03-22 2026-03-31 "
# a recurring document and scheduled jobs: made by the scheduler's own rules at each day crossed
close_body=$(python3 -c 'import json,sys; print(json.dumps({"period_name":"March 2026 close "+sys.argv[1],"start_date":"2026-03-01","end_date":"2026-03-31","company":sys.argv[2],"closed_documents":[{"document_type":t,"closed":1} for t in ("Sales Invoice","Purchase Invoice","Payment Entry","Journal Entry")]}))' "$RUN" "$COMPANY")
AP=$(dj doc create $SLUG "Accounting Period" --as $ADMIN --data "$close_body" | jget "d['data']['name']")
[ -n "$AP" ] && ok "B7 the month is closed: Accounting Period $AP (Sales Invoice, Purchase Invoice, Payment Entry, Journal Entry closed for March)" || bad "B7 close the month" "no accounting period"
chk "B7 a Sales Invoice dated in the closed month is refused" "$(dj doc create $SLUG "Sales Invoice" --as $SALES --data "{\"customer\":\"Lead Co $RUN\",\"company\":\"$COMPANY\",\"set_posting_time\":1,\"posting_date\":\"2026-03-15\",\"due_date\":\"2026-03-15\",\"items\":[{\"item_name\":\"Late\",\"qty\":1,\"rate\":1,\"income_account\":\"Sales - $ABBR\"}]}" | jget "d['error']['code'] if not d['ok'] else d['data']['name']")" INVALID
# the world moves back to the host's time, closes the period for the next run
dj doc delete $SLUG "Accounting Period" "$AP" --as $ADMIN >/dev/null 2>&1
core world clock reset main --as operator >/dev/null 2>&1
chk "B7 clock reset: the chain and every site are back on the host's time" "$(dj world clock show main | jget "(d['data']['offsetMs'], sorted(set(s['today'] for s in d['data']['sites'])) == [__import__('datetime').date.today().isoformat()], d['data']['chainLatestBlock'][:7] == d['data']['time'][:7])")" "(0, True, True)"

# ---------------------------------------------------------------------------------------------------------------
echo "== Behaviour 8: the record (one entry per command, in order; a money movement can be followed by its trace id)"
login_admin   # a cookie session does not survive the world's clock being moved (a finding): sign in again before the admin REST reads below
NREC=$(( $(wc -l < "$REC") - REC0 )); NCALLS=$(wc -l < "$CALLS" | tr -d " ")
chk "B8 the record has one entry per command of this run (every command, not only the successful ones)" "$NREC" "$NCALLS"
chk "B8 in order: sequence numbers run 1..n with no gap and each line carries the hash of the one before (tamper-evident)" "$(core record tail main --json --n 1 | jget "d['data']['chainOk']")" True
chk "B8 world time is in the entries: the March payments are recorded at their world dates" "$(python3 -c '
import json,sys
rs=[json.loads(l) for l in open(sys.argv[1])][int(sys.argv[2]):]   # this run only
print(sorted(set(r["world_time"][:10] for r in rs if r["command"]=="approval sign" and r["world_time"].startswith("2026-03"))))' "$REC" "$REC0")" "['2026-03-02', '2026-03-12', '2026-03-22', '2026-03-31']"
# follow the last payment: command -> chain transaction -> ledger entry, by trace id
LAST_TX=${TXS[3]}; SIGN_TRACE=$(python3 -c '
import json,sys
for l in open(sys.argv[1]):
    r=json.loads(l)
    if r["command"]=="approval sign" and any(t["hash"]==sys.argv[2] for t in r["changes"]["tx"]): print(r["trace"])' "$REC" "$LAST_TX")
chk "B8 the command's record names the chain transaction (trace $SIGN_TRACE -> $LAST_TX)" "$([ -n "$SIGN_TRACE" ] && echo found)" found
chk "B8 ... and the ledger entries carry the same trace id (GL Entry.capxul_trace), for the payment's voucher" "$(lst "$T/admin" "GL Entry" "[[\"capxul_trace\",\"=\",\"$SIGN_TRACE\"]]" '["voucher_no","voucher_type"]' | jget "sorted(set((g['voucher_type'], g['voucher_no']==\"${PES[3]}\") for g in d['data']))")" "[('Payment Entry', True)]"
chk "B8 ... and the Payment Entry's own timeline holds the trace id (a Comment)" "$(lst "$T/admin" Comment "[[\"reference_doctype\",\"=\",\"Payment Entry\"],[\"reference_name\",\"=\",\"${PES[3]}\"],[\"content\",\"like\",\"%$SIGN_TRACE%\"]]" '["name"]' | jget "len(d['data'])>=1")" True
chk "B8 ... and Core's log has the call under that trace id" "$(grep -c "trace $SIGN_TRACE" "$HERE/core/state/core.log" | awk '{print ($1>0)?"yes":"no"}')" yes
chk "B8 record show finds the command by its trace id" "$(core record show "$SIGN_TRACE" --json | jget "d['data']['command']")" "approval sign"
OUT_EXPORT="$T/export.jsonl"; core record export main --out "$OUT_EXPORT" >/dev/null
chk "B8 record export produces one file: a header line and every record, readable line by line" "$(python3 -c '
import json,sys
ls=[json.loads(l) for l in open(sys.argv[1])]
print(ls[0]["type"], ls[0]["chain_ok"], len(ls)-1==ls[0]["count"])' "$OUT_EXPORT")" "capxul-record-export True True"
leaks=0; for k in $(python3 -c "import json;p=json.load(open('$HERE/core/people.json'));print(' '.join([p['operator']['privateKey']]+[x['privateKey'] for x in p['people']]))") "$SKELETON_SECRET"; do n=$(cat "$HERE"/core/state/record/*.jsonl "$OUT_EXPORT" | grep -c -F "$k"); leaks=$((leaks+n)); done
chk "B8 no secret in the record or the export (grep for every test key and the shared secret)" "$leaks" 0

# ---------------------------------------------------------------------------------------------------------------
echo "== Behaviour 9: world snapshots (a world is saved, restored beside the original as a second world, and restored in place)"
W2=w2; core world delete $W2 --as operator >/dev/null 2>&1      # a world left by an earlier run
dj world clock set main 2026-06-01T10:00:00Z --as operator >/dev/null
sbal() { cast call "$USDC" "balanceOf(address)(uint256)" "$SAFE" --rpc-url "$1" | awk '{print $1}'; }
sum_of() { "$HERE/frappe/bin/bench-exec.sh" "$1" capxul.world.summary | grep -a CAPXUL_RESULT: | tail -1 | sed "s/.*CAPXUL_RESULT://" | python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); [d.pop(k) for k in ("site","world","now")]; print(json.dumps(d,sort_keys=True))'; }
pes() { sum_of "$1" | jget "d['docs']['Payment Entry']"; }
S0=$(sum_of $SITE); B0=$(sbal $RPC); P0=$(echo "$S0" | jget "d['docs']['Payment Entry']")
t0=$(ms); out=$(dj world snapshot save main --as operator --name "run-$RUN"); save_ms=$(( $(ms) - t0 ))
SNAP=$(echo "$out" | jget "d['data']['id']"); SNAP_MB=$(echo "$out" | jget "round(d['data']['bytes']/1e6,1)")
[ -n "$SNAP" ] && ok "B9 world main saved as $SNAP: every company, the whole chain, Core's state, the clock, record position $(echo "$out" | jget "d['data']['record']['count']"); ${save_ms}ms, ${SNAP_MB} MB" || bad "B9 snapshot save" "$out"
chk "B9 snapshot list shows it with its world, name and record position" "$(dj world snapshot list main | jget "[(s['world'], s['name']) for s in d['data']['snapshots'] if s['id']=='$SNAP']")" "[('main', 'run-$RUN')]"
chk "B9 a person who is not the operator cannot save or restore a world" "$(refused "$(dj world snapshot save main --as $ADMIN)") $(refused "$(dj world snapshot restore $SNAP --as $ADMIN --into zz)")" "NOT_WORLD_ADMIN NOT_WORLD_ADMIN"
core world clock reset main --as operator >/dev/null
t0=$(ms); out=$(dj world snapshot restore $SNAP --as operator --into $W2 --only $SLUG); into_ms=$(( $(ms) - t0 ))
[ "$(echo "$out" | jget "d['ok']")" = True ] && ok "B9 restored into a NEW world $W2 beside the original (own chain, own Core, site $SLUG.$W2.localhost) in ${into_ms}ms: $(echo "$out" | jget "d['data']['phasesMs']")" || bad "B9 restore into" "$out"
W2_RPC=$(core world show $W2 --json | jget "'http://127.0.0.1:%d' % d['data']['anvilPort']")
chk "B9 the new world has the same documents, ledger balances, hats, features and event position as the saved one" "$(sum_of $SLUG.$W2.localhost)" "$S0"
chk "B9 the new world's chain has the same balance in the company's Safe" "$(sbal $W2_RPC)" "$B0" "$B0 units"
chk "B9 the new world's clock resumed at the saved world time (1 June), on its chain and its site; the original is on the host's time" "$(dj world clock show $W2 | jget "(d['data']['time'][:10], d['data']['chainLatestBlock'][:10] <= '2026-11-10', [s['today'] for s in d['data']['sites']])") $(core world clock show main --json | jget "d['data']['offsetMs']")" "('2026-06-01', True, ['2026-06-01']) 0"
chk "B9 the restored site signs people in through the new world's Core and the door works there (hannah lists invoices as herself)" "$(dj doc list $SLUG "Sales Invoice" --as $ADMIN --world $W2 --limit 2 | jget "d['ok']")" True
chk "B9 the world list shows both worlds and where the new one came from" "$(core world list --json | jget "sorted((w['name'], (w['from'] or {}).get('snapshot','')) for w in d['data']['worlds'])")" "[('main', ''), ('$W2', '$SNAP')]"
# a payment in the new world does not appear in the old one, and the reverse
B1=$(sbal $RPC)
WORLD=$W2; read -r si pi pe tx <<<"$(mkpay 7.25 $W2)"; WORLD=""
[ -n "$tx" ] && ok "B9 a payment made in $W2 (invoice $si, payment $pe, tx $tx)" || bad "B9 payment in the new world" "no tx"
chk "B9 ... is in the new world ($(( P0 + 1 )) payment entries, Safe down 7.25) and not in the old ($P0, unchanged)" "$(pes $SLUG.$W2.localhost) $(( B0 - $(sbal $W2_RPC) )) $(pes $SITE) $(sbal $RPC)" "$((P0+1)) 7250000 $P0 $B0"
read -r si pi pe tx <<<"$(mkpay 3.10 main)"
chk "B9 a payment made in the old world is not in the new one (old $((P0+1)), new still $((P0+1)))" "$(pes $SITE) $(pes $SLUG.$W2.localhost) $(( B0 - $(sbal $RPC) ))" "$((P0+1)) $((P0+1)) 3100000"
# lineage in the record
SREC=$(dj world snapshot list main | jget "[s['record'] for s in d['data']['snapshots'] if s['id']=='$SNAP'][0]")
chk "B9 the new world's record begins with the old world's up to the snapshot, then says which snapshot it came from; its own commands follow" "$(python3 -c '
import json,sys
rs=[json.loads(l) for l in open(sys.argv[1])]
i=[k for k,r in enumerate(rs) if r.get("lineage")]
print(len(i), rs[i[0]]["lineage"]["snapshot"]==sys.argv[2], rs[i[0]]["seq"]==int(sys.argv[3])+1, any(r["command"]=="approval sign" for r in rs[i[0]+1:]))' "$HERE/core/state/worlds/$W2/record/$W2.jsonl" "$SNAP" "$SREC")" "1 True True True"
chk "B9 the old world's record says it made the new one (restore --into) and its own trace is not in the new world's record" "$(python3 -c '
import json,sys
a=[json.loads(l) for l in open(sys.argv[1])]; b=[json.loads(l) for l in open(sys.argv[2])]
print(any(r["command"]=="world snapshot restore" and r["changes"].get("lineage",{}).get("intoWorld")==sys.argv[3] for r in a), not any(r["id"]==a[-1]["id"] for r in b))' "$REC" "$HERE/core/state/worlds/$W2/record/$W2.jsonl" "$W2")" "True True"
# restore in place: main goes back to the saved moment
t0=$(ms); out=$(dj world snapshot restore $SNAP --as operator --in-place); inplace_ms=$(( $(ms) - t0 ))
[ "$(echo "$out" | jget "d['ok']")" = True ] && ok "B9 restore --in-place of the whole world main in ${inplace_ms}ms: $(echo "$out" | jget "d['data']['phasesMs']")" || bad "B9 restore in place" "$out"
chk "B9 in place: main is back at the saved moment (the payment made after the save is gone: documents, ledger, hats, features, balance)" "$(sum_of $SITE | python3 -c 'import sys; print(sys.stdin.read().strip())') $(sbal $RPC)" "$S0 $B0"
chk "B9 in place: the world clock is back at the saved world time on the chain and on all three sites" "$(core world clock show main --json | jget "(d['data']['time'][:10], d['data']['chainLatestBlock'][:10] <= '2026-11-10', sorted(set(s['today'] for s in d['data']['sites'])))")" "('2026-06-01', True, ['2026-06-01'])"
chk "B9 in place: the record of main was not rewound (it grew), and says what it was restored from" "$(python3 -c '
import json,sys
rs=[json.loads(l) for l in open(sys.argv[1])]
r=[x for x in rs if x["command"]=="world snapshot restore" and x["changes"].get("lineage",{}).get("intoWorld")=="main"]
print(len(r)>=1, rs[-1]["seq"]==len(rs))' "$REC")" "True True"
core world clock reset main --as operator >/dev/null; login_admin
info "B9 measured: save ${save_ms}ms, ${SNAP_MB} MB; restore into a new world (1 company) ${into_ms}ms; restore in place (whole world) ${inplace_ms}ms"

echo "== Privacy: nothing phones home"
for s in acme beta gamma; do
  [ "$(curl -s -H "X-Frappe-Site-Name: $s.localhost" $FR/api/method/ping | jget "d['message']")" = pong ] || continue
  chk "PRIVACY $s.localhost: no telemetry, no update check, no CRM usage-data screen, no enrichment, no vendor keys" "$( ( . "$HERE/frappe/bin/lib.sh"; inbench "bench --site $s.localhost execute capxul.privacy.status" 2>/dev/null | tail -1 ) | jget "(d['phoning_home'], d['enable_telemetry'], d['update_check_on'], d['crm_first_run_screen_pending'], d['domain_enrichment_on'], d['conf_keys_set'])")" "(False, 0, 0, 0, 0, [])"
done
fr "$T/admin" -o /dev/null -X PUT "$FR/api/resource/System%20Settings/System%20Settings" -d '{"enable_telemetry":1,"disable_system_update_notification":0}'
chk "PRIVACY ticking 'Share usage data' (it writes enable_telemetry) cannot turn it on: stays 0, update check stays off" "$(fr "$T/admin" "$FR/api/resource/System%20Settings/System%20Settings" | jget "(d['data']['enable_telemetry'], d['data']['disable_system_update_notification'])")" "(0, 1)"

echo "== Names: the site says Capxul, not Frappe or ERPNext (measured, not asserted)"
t0=$(ms); "$HERE/frappe/bin/find-names.sh" "$SLUG" $ADMIN jonas@acme.test > "$T/names.txt" 2>&1; names_ms=$(( $(ms) - t0 ))
FOUND=$(grep '^FOUND' "$T/names.txt" | tail -1)
if [ -n "$FOUND" ]; then ok "NAMES crawl as admin-hat and member-hat people finished in $((names_ms/1000)) s: $FOUND (shown = text a person reads; kept = copyright notice and third-party product names; covered = replaced by the person's own translations; internal = identifiers)"; else bad "NAMES crawl" "$(tail -c 300 "$T/names.txt")"; fi
grep -E '^(SHOWN|kept)' "$T/names.txt" | cut -c1-200 | while read -r l; do info "$l"; done

echo; echo "RESULT: $pass passed, $fail failed  (site http://$SITE:8000, sign in as $ADMIN or $BUDGET through http://localhost:8787)"
[ $fail = 0 ]
