# organizations: sourced by spikes/skeleton/run.sh; shared helpers and scenario state come from the harness.

register 10 B1 checks_organizations_10 ""
checks_organizations_10() {
REC="$HERE/core/state/record/main.jsonl"; REC0=$( [ -f "$REC" ] && wc -l < "$REC" || echo 0 ); REC0=$((REC0))
echo "== Behaviour 1: an org is one command"
existed=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Frappe-Site-Name: $SITE" $FR/api/method/ping)
[ "$existed" = 200 ] && info "site $SITE already exists: org create continues idempotently (reuses the Safe, re-runs the site script)"
t0=$(ms); out=$(core org create "$SLUG" "$COMPANY" --admin $ADMIN --co-director priya@acme.test 2>"$T/create.err"); rc=$?; create_ms=$(( $(ms) - t0 ))
[ $rc = 0 ] && ok B1.org-create "B1 org create exits 0 in $((create_ms/1000)) s" || { bad B1.org-create "B1 org create" "rc=$rc $(tail -c 400 "$T/create.err")"; exit 1; }
SAFE=$(echo "$out" | tail -1 | jget "d['safe']")
MINTED=$(core org chain-safe "$SLUG" | tr 'A-F' 'a-f'); M1=$(echo "$MINTED" | head -1); SAFE_LC=$(echo "$SAFE" | tr 'A-F' 'a-f')
chk B1.safe-on-chain-is-the-sites-safe "B1 chain: the Safe on the chain is the one the site was given" "$(echo "$MINTED" | tail -1)" "$SAFE_LC" "$SAFE holds $(usdc "$SAFE") units of test USDC"
chk B1.company-safe-minted-for-founder "B1 chain: CompanySafeMinted names the site's Safe, with the admin's personal Safe as founderSafe; its owners are the founding Directors' personal Safes" "$(echo "$M1" | jget "[d['safe'], d['founderSafe'] == d['founderPersonalSafe'] == d['directorSafes'][0], sorted(map(str.lower, d['owners'])) == sorted(map(str.lower, d['directorSafes']))]")" "['$SAFE_LC', True, True]" "minted in tx $(echo "$M1" | jget "d['mintTx']")"
chk B1.org-show-prints-the-safe "B1 read: org show prints the Safe CompanySafeMinted named" "$(core org show "$SLUG" | sed -n 's/^safe //p' | tr 'A-F' 'a-f')" "$SAFE_LC"
chk B1.site-answers-by-name "B1 the site answers (by name, $SITE:8000)" "$(curl -s --resolve "$SITE:8000:127.0.0.1" http://$SITE:8000/api/method/ping | jget "d['message']")" pong
login_admin
ABBR=$(lst "$T/admin" Company '[]' '["name","abbr"]' | jget "d['data'][0]['abbr']")
chk B1.company-exists "B1 the Company exists" "$(lst "$T/admin" Company '[]' '["name"]' | jget "'$COMPANY' in [c['name'] for c in d['data']]")" True
SAFE_ACCOUNT=$(fr "$T/admin" "$FR/api/method/frappe.client.get_single_value?doctype=Capxul%20Settings&field=safe_account" | jget "d['message']")
chk B1.safe-bank-account "B1 the Safe bank account exists, tied to the Safe address" "$(lst "$T/admin" "Bank Account" '[]' '["integration_id","account"]' | jget "[b['integration_id'].lower() for b in d['data'] if b['account']=='$SAFE_ACCOUNT']")" "['$(echo "$SAFE" | tr 'A-F' 'a-f')']" "$SAFE_ACCOUNT"
has_any_roles() { local r; r=$(roles_of "$1"); [ -n "$r" ] && [ "$r" != "[]" ]; }
if wait_for 30 has_any_roles $ADMIN; then ok B1.admin-hat-reaches-site "B1 the admin hat reached the site: the admin's User exists with roles ($(roles_of $ADMIN | cut -c1-60)...) ${WAITED}ms after org create returned"; else bad B1.admin-hat-reaches-site "B1 admin hat delivered" "no roles for $ADMIN"; fi
t0=$(ms); sso $ADMIN "$T/hannah"; rc=$?
chk B1.admin-sign-in-chain "B1 admin completes the sign-in chain against the Core stub: session user is the admin" "$rc" 0 "$(( $(ms) - t0 ))ms"
}

register 101 TL checks_organizations_101 "B9"
checks_organizations_101() {
# acc:org.member.grant/c-6412f20281167621: the company was born with a second Director (priya), so a grant proposed by the founder waits as
# a Board proposal; a non-Director cannot approve it; after priya approves it is applied, the member wears the hat and the
# hat's roles reach the site.
TLPROP=$(dj hat grant $SLUG member elena@brightside.test --propose --as $ADMIN); TLPID=$(echo "$TLPROP" | jget "d['data']['id']")
chk TL.grant-proposal-waits-for-second-director "TL hat grant --propose: the proposal waits, approved by the founder and not yet by priya; elena wears nothing yet" \
  "$(dj org proposal get $SLUG "$TLPID" | jget "(d['data']['state'], [(a['director'], a['approved']) for a in d['data']['approvals']])") $(dj org member get $SLUG elena@brightside.test | jget "d['data']['hats']")" \
  "('waiting', [('$ADMIN', True), ('priya@acme.test', False)]) []"
chk TL.grant-proposal-non-director-refused "TL a person who is not a Director ($BUDGET) cannot approve: ROLE_PERMISSION_DENIED, and the proposal still waits" \
  "$(refused "$(dj org proposal approve $SLUG "$TLPID" --as $BUDGET)") $(dj org proposal get $SLUG "$TLPID" | jget "d['data']['state']")" "ROLE_PERMISSION_DENIED waiting"
TLAPP=$(dj org proposal approve $SLUG "$TLPID" --as priya@acme.test)
chk TL.grant-proposal-applied-after-second-director "TL after priya approves: the proposal reads applied with both approvals, and org member get shows elena wearing member" \
  "$(echo "$TLAPP" | jget "(d['data']['state'], all(a['approved'] for a in d['data']['approvals']), d['data']['txHash'] is not None)") $(dj org member get $SLUG elena@brightside.test | jget "d['data']['hats']")" \
  "('applied', True, True) ['member']"
if wait_for 15 has_roles elena@brightside.test "['Employee']"; then ok TL.grant-proposal-roles-reach-site "TL the member hat's roles reach the site once the proposal is applied (${WAITED}ms)"; else bad TL.grant-proposal-roles-reach-site "TL roles after the applied proposal" "$(roles_of elena@brightside.test)"; fi
}
