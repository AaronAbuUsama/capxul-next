# plugs: sourced by spikes/skeleton/run.sh; shared helpers and scenario state come from the harness.

register 20 B2 checks_plugs_20 "B1"
checks_plugs_20() {
echo "== Behaviour 2: roles follow hats"
core hat revoke "$SLUG" budget-holder $BUDGET --department Finance >/dev/null 2>&1 && { wait_for 15 has_roles $BUDGET "[]"; info "cleaned a leftover budget-holder grant from an earlier run"; }
out=$(core hat grant "$SLUG" budget-holder $BUDGET --department Finance 2>&1); rc=$?; t0=$(ms)
[ $rc = 0 ] && ok B2.hat-grant-on-chain "B2 hat grant to a second person is on the chain" || bad B2.hat-grant-on-chain "B2 hat grant" "$out"
WANT="['Accounts User', 'Expense Approver', 'Purchase User']"
if wait_for 10 has_roles $BUDGET "$WANT"; then ok B2.roles-follow-grant "B2 mapped roles present $WAITED ms after the chain transaction was mined ($WANT)"; else bad B2.roles-follow-grant "B2 roles follow the grant" "$(roles_of $BUDGET) after 10 s"; fi
chk B2.department-limit-exists "B2 the department limit exists (User Permission on Department)" "$([[ "$(dept_perm $BUDGET)" == "['Finance"* ]] && echo yes || echo no)" yes "$(dept_perm $BUDGET)"
code=$(fr "$T/admin" -o /dev/null -w '%{http_code}' -X PUT "$FR/api/resource/User/$BUDGET" -d '{"roles":[{"role":"System Manager"}]}')
chk B2.hand-edit-of-roles-refused "B2 a hand edit of roles through the REST API (as Administrator) is refused" "$code $(roles_of $BUDGET)" "403 $WANT"
out=$(core hat revoke "$SLUG" budget-holder $BUDGET --department Finance 2>&1); t0=$(ms)
if wait_for 10 has_roles $BUDGET "[]"; then ok B2.revoke-removes-roles "B2 hat revoke removes every role $WAITED ms after the chain transaction"; else bad B2.revoke-removes-roles "B2 revoke removes roles" "$(roles_of $BUDGET)"; fi
chk B2.revoke-removes-department-limit "B2 revoke removes the department limit" "$(dept_perm $BUDGET)" "[]"
core hat grant "$SLUG" budget-holder $BUDGET --department Finance >/dev/null 2>&1; wait_for 10 has_roles $BUDGET "$WANT"   # the payer for what follows
}

register 40 B4 checks_plugs_40 "B3"
checks_plugs_40() {
echo "== Behaviour 4: it stays true when broken"
# (a) a person without the hat. payroll-approver gets Frappe roles that may submit a Payment Entry (a site-side map edit),
#     but the chain gives that hat no payment authority.
fr "$T/admin" "$FR/api/resource/Capxul%20Hat%20Map/payroll-approver" > "$T/map.json"
core hat revoke "$SLUG" payroll-approver $PAYROLL >/dev/null 2>&1 && wait_for 15 has_roles $PAYROLL "[]"
fr "$T/admin" -o /dev/null -X PUT "$FR/api/resource/Capxul%20Hat%20Map/payroll-approver" -d '{"roles":[{"role":"HR Manager"},{"role":"HR User"},{"role":"Accounts User"},{"role":"Purchase User"}]}'
core hat grant "$SLUG" payroll-approver $PAYROLL >/dev/null 2>&1; wait_for 10 has_roles $PAYROLL "['Accounts User', 'HR Manager', 'HR User', 'Purchase User']"
sso $PAYROLL "$T/tomas"
read -r PI4 PE4 <<<"$(mk_pe "$T/tomas" 80.00)"
[ -n "${PE4:-}" ] || bad B4a.make-payroll-approver-entry "4a make the payroll-approver's payment entry" "$(tail -c 300 "$T/pe.json")"
ans=$(request "$T/tomas" "$PE4"); APR=$(echo "$ans" | jget "d['message']['approval_url']"); APR=${APR##*/}
B_TO=$(usdc $SUPPLIER_ADDR); res=$(approval_sign "$APR")
chk B4a.signer-without-hat-refused-by-chain "4a signer without the payment hat: the chain refuses" "$(echo "$res" | jget "(d['status'], d['reason'])")" "('failed', 'NOT_AUTHORISED')"
wait_for 20 bash -c "[ \"\$(curl -s -b $T/admin -H 'X-Frappe-Site-Name: $SITE' $FR/api/resource/Payment%20Entry/$PE4 | python3 -c 'import json,sys; print(json.load(sys.stdin)[\"data\"][\"capxul_status\"])')\" != 'Waiting for signature' ]"
chk B4a.entry-not-posted-and-shows-why "4a the entry is not posted and shows why" "$(pe_field "$PE4" docstatus) $(pe_field "$PE4" capxul_status | cut -c1-22 | tr ' ' _) $(gl_of "$PE4" | jget "len(d['data'])")" "0 Failed:_NOT_AUTHORISED 0" "$(pe_field "$PE4" capxul_status)"
chk B4a.no-money-moved "4a no money moved" "$(( $(usdc $SUPPLIER_ADDR) - B_TO ))" 0
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
chk B4b.redelivery-answered-already-applied "4b Core delivered seq $SEQ (payment_sent) a second time and Frappe answered 'already applied'" "$(grep -c "seq $SEQ payment_sent already applied" "$HERE/core/state/core.log")" "$((dup0+1))"
chk B4b.one-posting "4b one posting: still 1 applied event, $gl0 ledger rows, entry submitted once" "$(n_sent_events) $(gl_of "$PE_B3" | jget "len(d['data'])") $(pe_field "$PE_B3" docstatus)" "$n0 $gl0 1"

# (c) Frappe is down when the log lands
read -r PI5 PE5 <<<"$(mk_pe "$T/marcus" 60.00)"
ans=$(request "$T/marcus" "$PE5"); APR=$(echo "$ans" | jget "d['message']['approval_url']"); APR=${APR##*/}
n0=$(n_sent_events); B_TO=$(usdc $SUPPLIER_ADDR)
"$STACK_FRAPPE/bin/down.sh" >/dev/null 2>&1
res=$(approval_sign "$APR"); TX5=$(echo "$res" | jget "d['txHash']")
chk B4c.signed-while-frappe-down-money-moved "4c signed while Frappe is down: the chain moved the money" "$(( $(usdc $SUPPLIER_ADDR) - B_TO ))" 60000000 "tx $TX5"
wait_for 10 bash -c "core events status $SLUG | grep -q 'pending=[1-9]'"
chk B4c.core-holds-undelivered-event "4c Core holds the undelivered event in its outbox" "$(core events status "$SLUG" | head -1 | grep -o 'pending=[0-9]*')" "pending=1" "$(core events status "$SLUG" | sed -n 2p | cut -c1-90)"
t0=$(ms); "$STACK_FRAPPE/bin/up.sh" >/dev/null 2>&1; up_ms=$(( $(ms) - t0 )); info "Frappe stack back up in $((up_ms/1000)) s"
login_admin; t0=$(ms); wait_for 90 pe_posted "$PE5"; ok_c=$?; posted_ms=$(( $(ms) - t0 ))
chk B4c.entry-posts-after-frappe-returns "4c after Frappe starts the entry posts with nobody re-sending by hand" "$(pe_field "$PE5" docstatus) $ok_c" "1 0" "${posted_ms}ms after the stack answered"
sleep 2
chk B4c.exactly-once "4c exactly once: 1 new applied event, 2 ledger rows, Core outbox empty" "$(( $(n_sent_events) - n0 )) $(gl_of "$PE5" | jget "len(d['data'])") $(core events status "$SLUG" | head -1 | grep -o 'pending=[0-9]*')" "1 2 pending=0"

# (d) direct submit of a Safe-backed Payment Entry
code=$(fr "$T/admin" -o "$T/o" -w '%{http_code}' -X PUT "$FR/api/resource/Payment%20Entry/$PE4" -d '{"docstatus":1}')
chk B4d.direct-submit-refused "4d direct submit of a Safe-backed Payment Entry (REST, as Administrator) is refused, nothing posted" "$code $(pe_field "$PE4" docstatus) $(gl_of "$PE4" | jget "len(d['data'])")" "417 0 0"
code=$(fr "$T/marcus" -o /dev/null -w '%{http_code}' -X POST $FR/api/method/frappe.client.submit -d "{\"doc\":$(fr "$T/admin" "$FR/api/resource/Payment%20Entry/$PE4" | jget "__import__('json').dumps(d['data'])")}")
chk B4d.client-submit-refused "4d the same through frappe.client.submit as the budget-holder is refused" "$code" 417

# (e) pay direct on the chain, no document
out=$(core pay direct "$SLUG" $DIRECT_TO 40 2>&1); TXD=$(echo "$out" | grep -o 'tx 0x[0-9a-f]*' | awk '{print $2}')
[ -n "$TXD" ] || bad B4e.pay-direct "4e pay direct" "$out"
bt() { lst "$T/admin" "Bank Transaction" "[[\"transaction_id\",\"=\",\"$TXD\"]]" '["withdrawal","status","bank_account"]' | jget "[(b['withdrawal'], b['status']) for b in d['data']]"; }
wait_for 20 bash -c "[ \"\$(curl -s -b $T/admin -H 'X-Frappe-Site-Name: $SITE' -G $FR/api/resource/Bank%20Transaction --data-urlencode 'filters=[[\"transaction_id\",\"=\",\"$TXD\"]]' | python3 -c 'import json,sys; print(len(json.load(sys.stdin)[\"data\"]))')\" = 1 ]"
chk B4e.chain-payment-without-document-is-unreconciled "4e a chain payment with no document is an unreconciled Bank Transaction" "$(bt)" "[(40.0, 'Unreconciled')]" "tx $TXD"

# (f) Administrator is not a person on the chain: it cannot ask for a payment (Core cannot map it to a signer)
out=$(request "$T/admin" "$PE4"); chk B4f.administrator-request-refused "4f Administrator asking for a payment is refused with the reason, nothing sent" "$(echo "$out" | jget "'not a person Capxul knows' in d['exception']") $(pe_field "$PE4" docstatus)" "True 0" "$(echo "$out" | jget "d['exception'][:150]")"

# (g) an event the site cannot apply must not block the org's later events: a hat granted to an address Core has no email for
UNKNOWN=$(python3 -c 'import secrets;print("0x"+secrets.token_hex(20))'); HATS=$(python3 -c "import json;print(json.load(open('$HERE/core/state/deployment.json'))['hats'])")
HK=$(python3 -c "import json;print([p for p in json.load(open('$HERE/core/people.json'))['people'] if p['email']=='$ADMIN'][0]['privateKey'])")   # anvil's published test key
core hat grant "$SLUG" member nobody@unknown.test --address "$UNKNOWN" --as $ADMIN >/dev/null 2>&1   # straight to the chain: Core has no person for the address
t0=$(ms); wait_for 30 bash -c "core events status $SLUG | head -1 | grep -q 'pending=0'"
chk B4g.poison-event-outbox-drains "4g poison event: Core's outbox drains (the unappliable event is parked, not retried for ever)" "$(core events status "$SLUG" | head -1 | grep -o 'pending=[0-9]*')" "pending=0" "$((WAITED))ms"
chk B4g.parked-event-visible-with-reason "4g the parked event is visible on the site with its reason" "$(lst "$T/admin" "Capxul Chain Event" '[["status","=","Parked"]]' '["error"]' | jget "'has no person_email' in d['data'][-1]['error']")" True
core hat grant "$SLUG" member jonas@acme.test >/dev/null 2>&1; wait_for 15 has_roles jonas@acme.test "['Employee']"
chk B4g.later-hat-still-reaches-site "4g a hat granted after the poison event still reaches the site" "$(roles_of jonas@acme.test)" "['Employee']" "${WAITED}ms"
core hat revoke "$SLUG" member jonas@acme.test >/dev/null 2>&1
}
