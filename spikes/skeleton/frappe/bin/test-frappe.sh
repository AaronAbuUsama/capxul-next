#!/usr/bin/env bash
# Proves the Frappe half without Core: fake signed chain_event calls + a ten-line fake /prepare on :8787
# (stopped at the end). A fresh site each run unless REUSE=1. Prints PASS/FAIL per check.
set -uo pipefail
. "$(dirname "$0")/lib.sh"
SLUG="${SLUG:-fxtest}"; SITE="$SLUG.localhost"; API=http://127.0.0.1:8000
SAFE=0x3c44cdc8f4a1b0e2d5e6f7a8b9c0d1e2f3a4b5c6
TMP="$(mktemp -d)"; FAKE_OUT="$TMP/prepare.jsonl"; JAR="$TMP/jar"; : > "$FAKE_OUT"
pass=0; fail=0
ok()  { echo "PASS $1"; pass=$((pass+1)); }
bad() { echo "FAIL $1 :: $2"; fail=$((fail+1)); }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }
cleanup() { [ -n "${FAKE_PID:-}" ] && kill "$FAKE_PID" 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

sig() { printf %s "$1" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $NF}'; }
# event <seq> <key> <kind> '<data json>'  -> sets CODE and BODY
event() {   # seq is relative to the site's cursor at the start of the run, so REUSE=1 works
  local body; body=$(printf '{"event_key":"%s","seq":%s,"org":"%s","kind":"%s","data":%s}' "${KEYP}$2" "$((BASE+$1))" "$SLUG" "$3" "$4")
  CODE=$(curl -s -o "$TMP/body" -w '%{http_code}' -X POST "$API/api/method/capxul.api.chain_event" -H "X-Frappe-Site-Name: $SITE" \
    -H 'Content-Type: application/json' -H "X-Capxul-Signature: ${SIGOVERRIDE:-$(sig "$body")}" --data-binary "$body"); BODY=$(cat "$TMP/body")
}
KEYP="r$$:"; BASE=0
jx() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))' "$1" 2>/dev/null; }
# run a helper in capxul.testutil, print its JSON line
exe() { inbench "bench --site $SITE execute capxul.testutil.$1 ${2:+--args \"$2\"}" 2>/dev/null | sed -n 's/^JSON://p' | tail -1; }
login() { curl -s -c "$JAR" -o /dev/null -H "X-Frappe-Site-Name: $SITE" -d usr=Administrator -d "pwd=$ADMIN_PASSWORD" "$API/api/method/login"; }
rest() { curl -s -b "$JAR" -H "X-Frappe-Site-Name: $SITE" -H 'Content-Type: application/json' "$@"; }

# ---- fake Core ---------------------------------------------------------------------------------------------
FAKE_PORT=8787; lsof -iTCP:8787 -sTCP:LISTEN >/dev/null 2>&1 && FAKE_PORT=8799   # the real Core stub may be up
SECRET="$SECRET" FAKE_OUT="$FAKE_OUT" FAKE_PORT=$FAKE_PORT python3 "$(dirname "$0")/fake_core.py" & FAKE_PID=$!

# ---- site --------------------------------------------------------------------------------------------------
if [ "${REUSE:-0}" != 1 ]; then
  inbench "bench drop-site $SITE --db-root-password 123 --force" >/dev/null 2>&1 || true
  t0=$(date +%s)
  "$(dirname "$0")/new-site.sh" "$SLUG" "Acme Trading Ltd" "$SAFE" hannah@acme.test > "$TMP/newsite.out" 2> "$TMP/newsite.err"; rc=$?
  echo "INFO new-site.sh took $(( $(date +%s) - t0 ))s (exit $rc), last line: $(tail -1 "$TMP/newsite.out")"
  [ $rc = 0 ] || { tail -20 "$TMP/newsite.err"; bad "new-site.sh exits 0" "rc=$rc"; exit 1; }
  t0=$(date +%s)
  "$(dirname "$0")/new-site.sh" "$SLUG" "Acme Trading Ltd" "$SAFE" hannah@acme.test >/dev/null 2>&1 && ok "new-site.sh is safe to re-run ($(( $(date +%s) - t0 ))s)" || bad "new-site.sh is safe to re-run" "second run failed"
fi
login
# a NEW site reports nothing outward by default (capxul.privacy.status reads telemetry, update check, CRM consent screen, enrichment, keys)
check "new site: nothing phones home (telemetry, update check, CRM usage-data screen, enrichment, vendor keys all off)" "$(inbench "bench --site $SITE execute capxul.privacy.status" 2>/dev/null | tail -1 | jx "(d['phoning_home'], d['enable_telemetry'], d['update_check_on'], d['crm_first_run_screen_pending'], d['domain_enrichment_on'], d['conf_keys_set'])")" "(False, 0, 0, 0, 0, [])"
# point this site at the fake Core for the duration of the test (the real stub may own :8787)
rest -o /dev/null -X PUT "$API/api/resource/Capxul%20Settings/Capxul%20Settings" -d "{\"core_url\":\"http://host.docker.internal:$FAKE_PORT\"}"
BASE=$(rest "$API/api/method/frappe.client.get_single_value?doctype=Capxul%20Settings&field=last_seq" | jx "int(d['message'] or 0)")
check "site answers by X-Frappe-Site-Name" "$(curl -s -H "X-Frappe-Site-Name: $SITE" $API/api/method/ping | jx "d['message']")" pong
check "site answers by Host name" "$(curl -s -H "Host: $SITE:8000" $API/api/method/ping | jx "d['message']")" pong
company=$(rest "$API/api/resource/Company" | jx "[c['name'] for c in d['data']]"); [[ "$company" == *"Acme Trading Ltd"* ]] && ok "company exists ($company)" || bad "company exists" "$company"
ba=$(rest "$API/api/resource/Bank%20Account?fields=%5B%22name%22,%22integration_id%22,%22account%22%5D" | jx "[(b['integration_id'], b['account']) for b in d['data']]")
[[ "$ba" == *"$SAFE"* ]] && ok "Safe bank account + ledger account exist $ba" || bad "Safe bank account" "$ba"
slk=$(rest "$API/api/resource/Social%20Login%20Key" | jx "[s['name'] for s in d['data']]"); [[ "$slk" == *capxul* ]] && ok "Social Login Key exists" || bad "Social Login Key" "$slk"
check "default hat map has 7 hats (the four of the skeleton, and sales, hr-manager, project-manager)" "$(rest "$API/api/resource/Capxul%20Hat%20Map" | jx "len(d['data'])")" 7

# ---- chain_event: signature, seq, idempotency -----------------------------------------------------------------
H1='{"hat":"admin","person_email":"hannah@acme.test","person_name":"Hannah Okafor"}'
SIGOVERRIDE=deadbeef event 1 a hat_granted "$H1"; check "bad signature -> 401" "$CODE" 401
event 4 a hat_granted "$H1"
check "seq ahead -> 409 with expected next seq" "$CODE $(echo "$BODY" | jx "d.get('expected')==$BASE+1")" "409 True"
t1=$(python3 -c 'import time;print(time.time())')
event 1 a hat_granted "$H1"
t2=$(python3 -c 'import time;print(time.time())')
check "hat_granted applied" "$CODE $(echo "$BODY" | jx "(d['message']['applied'], d['message']['last_seq']==$BASE+1)")" "200 (True, True)"
echo "INFO hat_granted answered in $(python3 -c "print(round($t2-$t1,2))")s (roles are applied before the answer)"
event 1 a hat_granted "$H1"
check "repeated event_key -> 200 applied false" "$CODE $(echo "$BODY" | jx "d['message']['applied']")" "200 False"

# ---- roles follow hats -------------------------------------------------------------------------------------------
u=$(exe user_state "['hannah@acme.test']"); [[ "$(echo "$u" | jx "'System Manager' in d['roles'] and 'Accounts Manager' in d['roles']")" == True ]] && ok "admin hat gives System Manager + Accounts Manager" || bad "admin hat roles" "$u"
event 2 b hat_granted '{"hat":"budget-holder","person_email":"olu@acme.test","person_name":"Olu Bello","department":"Finance"}'
u=$(exe user_state "['olu@acme.test']"); check "budget-holder roles" "$(echo "$u" | jx "d['roles']")" "['Accounts User', 'Expense Approver', 'Purchase User']"
[[ "$(echo "$u" | jx "d['perms']")" == *"Department:Finance"* ]] && ok "department User Permission created ($u)" || bad "department User Permission" "$u"
event 3 c hat_granted '{"hat":"admin","person_email":"olu@acme.test","person_name":"Olu Bello"}'
event 4 d hat_revoked '{"hat":"budget-holder","person_email":"olu@acme.test","department":"Finance"}'
u=$(exe user_state "['olu@acme.test']")
check "revoke keeps a role another hat still gives, drops the rest" "$(echo "$u" | jx "'Accounts User' in d['roles'] and 'Expense Approver' not in d['roles']")" True
check "revoke removes the department limit" "$(echo "$u" | jx "d['perms']")" "[]"
event 5 e hat_revoked '{"hat":"admin","person_email":"olu@acme.test"}'
check "revoking the last hat removes every role" "$(exe user_state "['olu@acme.test']" | jx "d['roles']")" "[]"

# ---- roles cannot be changed by hand -------------------------------------------------------------------------------
event 6 f hat_granted '{"hat":"member","person_email":"mia@acme.test","person_name":"Mia Chen"}'
code=$(rest -o "$TMP/o" -w '%{http_code}' -X PUT "$API/api/resource/User/mia@acme.test" -d '{"roles":[{"role":"System Manager"},{"role":"Employee"}]}')
check "Administrator editing roles over REST is refused" "$code $(exe user_state "['mia@acme.test']" | jx "d['roles']")" "403 ['Employee']"
check "add_roles by code as Administrator refused" "$(exe try_roles "['mia@acme.test','add_roles','Sales Manager']" | jx "d['refused']")" True
check "remove_roles by code as Administrator refused" "$(exe try_roles "['mia@acme.test','remove_roles','Employee']" | jx "d['refused']")" True
check "roles untouched after the attempts" "$(exe user_state "['mia@acme.test']" | jx "d['roles']")" "['Employee']"

# ---- paying: the normal flow, posted only when the chain says so ---------------------------------------------------------
fx=$(exe make_payable); PE=$(echo "$fx" | jx "d['pe']"); PI=$(echo "$fx" | jx "d['pi']")
[ -n "$PE" ] && ok "fixture: Purchase Invoice $PI + draft Payment Entry $PE from the Safe account" || { bad "fixture" "$fx"; exit 1; }
pe_state() { exe state "['$PE','$PI']"; }
code=$(rest -o "$TMP/o" -w '%{http_code}' -X PUT "$API/api/resource/Payment%20Entry/$PE" -d '{"docstatus":1}')
s=$(pe_state); check "direct submit (REST docstatus=1) is refused, nothing posted" "$code $(echo "$s" | jx "(d['pe']['docstatus'], len(d['gl']))")" "417 (0, 0)"
echo "INFO refusal text: $(python3 -c "import json;print(json.loads(json.loads(open('$TMP/o').read())['_server_messages'])[0][:0] or json.loads(json.loads(json.loads(open('$TMP/o').read())['_server_messages'])[0])['message'][:130])" 2>/dev/null)"
r=$(rest -X POST "$API/api/method/capxul.api.request_payment" -d "{\"name\":\"$PE\"}")
check "Submit -> request recorded, status waiting for signature" "$(echo "$r" | jx "d['message']['status']")" "Waiting for signature"
echo "INFO approval link: $(echo "$r" | jx "d['message']['approval_url']")"
s=$(pe_state); check "still a draft, ledger untouched while waiting" "$(echo "$s" | jx "(d['pe']['docstatus'], d['pe']['capxul_status'], len(d['gl']), d['outstanding'])")" "(0, 'Waiting for signature', 0, 125.5)"
HASH=$(tail -1 "$FAKE_OUT" | jx "d['document_hash']"); check "Core received a signed /prepare with the document hash" "$(tail -1 "$FAKE_OUT" | jx "(d['org'], d['name']=='$PE', d['amount'], d['asset'], d['to_address'][:6], len(d['document_hash']))")" "('$SLUG', True, '125.50', 'USDC', '0x7099', 66)"
event 7 "approval:apr_fake1:failed" payment_failed "{\"approval_id\":\"apr_fake1\",\"document_hash\":\"$HASH\",\"reason\":\"OVER_BUDGET\",\"detail\":\"no room\"}"
s=$(pe_state); check "payment_failed leaves it unposted and shows the reason" "$(echo "$s" | jx "(d['pe']['docstatus'], 'OVER_BUDGET' in d['pe']['capxul_status'], len(d['gl']))")" "(0, True, 0)"
r=$(rest -X POST "$API/api/method/capxul.api.request_payment" -d "{\"name\":\"$PE\"}"); check "asking again after a failure works" "$(echo "$r" | jx "d['message']['status']")" "Waiting for signature"
TX=0x$(printf 'a%.0s' $(seq 64)); SENT="{\"payment_id\":\"0x01\",\"document_hash\":\"$HASH\",\"from_safe\":\"$SAFE\",\"to\":\"0x70997970c51812dc3a010c7d01b50e0d17dc79c8\",\"amount\":\"125.50\",\"asset\":\"USDC\",\"tx_hash\":\"$TX\",\"block_time\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
event 8 "31337:0xb1:3" payment_sent "$SENT"; check "payment_sent accepted" "$CODE" 200
s=$(pe_state)
check "Payment Entry submitted with the transaction hash" "$(echo "$s" | jx "(d['pe']['docstatus'], d['pe']['reference_no']=='$TX', d['pe']['capxul_status'])")" "(1, True, 'Sent')"
check "ledger posted: Safe account credited 125.50" "$(echo "$s" | jx "d['safe_credit']")" 125.5
check "invoice shows nothing outstanding" "$(echo "$s" | jx "d['outstanding']")" 0.0
event 8 "31337:0xb1:3" payment_sent "$SENT"; s2=$(pe_state)
check "same payment_sent twice posts once" "$CODE $(echo "$BODY" | jx "d['message']['applied']") $(echo "$s2" | jx "len(d['gl'])")" "200 False 2"
UTX=0x$(printf 'd%.0s' $(seq 64))
event 9 "31337:0xb2:0" payment_sent "{\"payment_id\":\"0x02\",\"document_hash\":\"0x$(printf 'c%.0s' $(seq 64))\",\"from_safe\":\"$SAFE\",\"to\":\"0x90f79bf6eb2c4f870365e785982e1f101e93b906\",\"amount\":\"40.00\",\"asset\":\"USDC\",\"tx_hash\":\"$UTX\",\"block_time\":\"2026-11-10T12:00:00Z\"}"
check "chain payment with no document -> unreconciled Bank Transaction" "$(exe bank_transactions | jx "[(b['withdrawal'], b['status']) for b in d if b['transaction_id']=='$UTX']")" "[(40.0, 'Unreconciled')]"
check "no other ledger credit to the Safe (Journal Entry refused)" "$(exe journal_credit_safe | jx "d['refused']")" True
code=$(rest -o "$TMP/o" -w '%{http_code}' -X POST "$API/api/method/frappe.client.cancel" -d "{\"doctype\":\"Payment Entry\",\"name\":\"$PE\"}"); check "cancelling a posted Safe payment is refused" "$code" 417
check "every applied event is in the inbox" "$(rest "$API/api/resource/Capxul%20Chain%20Event?limit=200&filters=%5B%5B%22event_key%22,%22like%22,%22${KEYP}%25%22%5D%5D" | jx "len(d['data'])")" 9

echo; echo "RESULT: $pass passed, $fail failed"; [ $fail = 0 ]
