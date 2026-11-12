# sites: sourced by spikes/skeleton/run.sh; shared helpers and scenario state come from the harness.

register 50 B5 checks_sites_50 "B1"
checks_sites_50() {
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
chk B5.feature-list-state "B5 feature list shows the defaults on the site" "$(core feature list "$SLUG" | awk 'NR>1{printf "%s=%s ", $1, $2}')" "accounts=on people=on payroll=on projects=on crm=on whatsapp=off stock=off manufacturing=off "
chk B5.feature-state-readable-from-site "B5 the same state is readable from the site itself (REST, as the admin-hat person)" "$(fr "$T/hannah" "$FR/api/method/capxul.features.status" | jget "d['message']['features']['crm']+d['message']['features']['whatsapp']")" onoff
out=$(core feature off "$SLUG" projects --as $BUDGET 2>&1); rc=$?
chk B5.person-without-admin-hat-refused "B5 a person without the admin hat is refused, with the reason" "$rc $(echo "$out" | grep -c 'does not wear the admin hat') $(feat projects)" "1 1 on"
# projects: a record, then off. (Two sessions for the same person: opening the desk gives a session a CSRF token, after which
# a bare curl POST is refused 400, so the desk and /crm page checks use their own session.)
sso $ADMIN "$T/hannah"; sso $ADMIN "$T/hannahd"
fr "$T/hannah" -X POST $FR/api/resource/Project -d "{\"project_name\":\"B5 Project $(date +%s)\"}" >/dev/null
PNAME=$(lst "$T/hannah" Project '[]' '["name"]' | jget "d['data'][0]['name']")
P0=$(fcount Project); [ -n "$P0" ] && [ "$P0" -ge 1 ] 2>/dev/null && ok B5.project-exists-before-switching "B5 a Project exists before switching ($P0 in the database)" || bad B5.project-exists-before-switching "B5 a Project exists" "count=[$P0]"
chk B5.before-off-rest-and-desk "B5 before off: the admin-hat person reads Projects over REST and has them on the desk" "$(code_of "$T/hannah" "$FR/api/resource/Project") $(desk_has "$T/hannahd" Projects)" "200 True"
t0=$(ms); core feature off "$SLUG" projects --as $ADMIN >/dev/null 2>"$T/off.err"; rc=$?; off_ms=$(( $(ms) - t0 ))
chk B5.feature-off-by-admin "B5 feature off projects by the admin" "$rc $(feat projects)" "0 off" "${off_ms}ms"
chk B5.off-project-unreachable-over-rest "B5 off: Project is unreachable over REST for the admin-hat person (list, read one, create, client.get_list)" "$(code_of "$T/hannah" "$FR/api/resource/Project") $(code_of "$T/hannah" "$FR/api/resource/Project/$PNAME") $(code_of "$T/hannah" -X POST "$FR/api/resource/Project" -d '{"project_name":"nope"}') $(code_of "$T/hannah" -G "$FR/api/method/frappe.client.get_list" --data-urlencode doctype=Project)" "403 403 403 403"
chk B5.off-refused-for-administrator "B5 off: also refused for Administrator over REST (the guard does not look at who)" "$(code_of "$T/admin" "$FR/api/resource/Project")" 403
chk B5.off-gone-from-desk "B5 off: Projects is gone from the person's desk" "$(desk_has "$T/hannahd" Projects)" False
chk B5.off-records-kept "B5 off: the records are still in the database (bench-side count)" "$(fcount Project)" "$P0"
core feature on "$SLUG" projects --as $ADMIN >/dev/null 2>&1
chk B5.on-again-restores-everything "B5 on again: REST answers, the desk shows Projects, the same records are there" "$(code_of "$T/hannah" "$FR/api/resource/Project") $(desk_has "$T/hannahd" Projects) $(lst "$T/hannah" Project '[]' '["name"]' | jget "len(d['data'])")" "200 True $P0"
# crm and whatsapp
out=$(core feature off "$SLUG" crm --as $ADMIN 2>&1); chk B5.crm-off-refused "B5 crm off: Frappe CRM's /crm and its API answer 403 for the admin-hat person" "$(code_of "$T/hannahd" $FR/crm) $(code_of "$T/hannah" "$FR/api/method/crm.api.session.get_users") $(code_of "$T/hannah" "$FR/api/resource/CRM%20Deal")" "403 403 403"
out=$(core feature on "$SLUG" whatsapp --as $ADMIN 2>&1); rc=$?
chk B5.whatsapp-needs-crm "B5 whatsapp on while crm is off is refused with the reason, nothing installed or changed" "$rc $(echo "$out" | grep -c 'needs crm') $(feat whatsapp)" "1 1 off"
core feature on "$SLUG" crm --as $ADMIN >/dev/null 2>&1
core hat grant "$SLUG" member jonas@acme.test >/dev/null 2>&1; wait_for 15 has_roles jonas@acme.test "['Employee']"; sso jonas@acme.test "$T/jonas"
chk B5.crm-on-screens-answer "B5 crm on: the CRM screens answer for the admin-hat person (the page and its API)" "$(code_of "$T/hannahd" $FR/crm) $(code_of "$T/hannah" "$FR/api/method/crm.api.session.get_users") $(desk_has "$T/hannahd" FCRM)" "200 200 True"
chk B5.crm-not-for-member-hat "B5 ... and not for a person with only the member hat" "$(code_of "$T/jonas" $FR/crm) $(code_of "$T/jonas" "$FR/api/method/crm.api.session.get_users")" "403 403"
# a won deal becomes a Customer (configuration only: ERPNext CRM Settings)
ORG="Gamma $(date +%s) Ltd"
fr "$T/hannah" -X POST $FR/api/resource/CRM%20Organization -d "{\"organization_name\":\"$ORG\"}" >/dev/null
DEAL=$(fr "$T/hannah" -X POST $FR/api/resource/CRM%20Deal -d "{\"organization\":\"$ORG\",\"status\":\"Qualification\",\"lead_name\":\"Gina Gamma\",\"deal_value\":12000,\"currency\":\"USD\"}" | jget "d['data']['name']")
fr "$T/hannah" -X PUT "$FR/api/resource/CRM%20Deal/$DEAL" -d '{"status":"Won"}' >/dev/null
chk B5.won-deal-becomes-customer "B5 a deal moved to Won becomes an ERPNext Customer carrying the deal's name, type and back-reference" "$(fr "$T/hannah" "$FR/api/resource/Customer/${ORG// /%20}" | jget "(d['data']['customer_type'], d['data']['crm_deal']=='$DEAL')") $(fr "$T/hannah" "$FR/api/resource/CRM%20Deal/$DEAL" | jget "d['data']['erpnext_customer']==\"$ORG\"")" "('Company', True) True"
t0=$(ms); core feature on "$SLUG" whatsapp --as $ADMIN >/dev/null 2>"$T/wa.err"; rc=$?; wa_ms=$(( $(ms) - t0 ))
chk B5.whatsapp-on-not-configured "B5 whatsapp on (crm on): installs the app if needed; it is on and answers as not configured (no credentials)" "$rc $(feat whatsapp) $(fr "$T/hannah" "$FR/api/method/crm.api.whatsapp.is_whatsapp_installed" | jget "d['message']") $(fr "$T/hannah" "$FR/api/method/crm.api.whatsapp.is_whatsapp_enabled" | jget "d['message']")" "0 on True False" "${wa_ms}ms"
core feature off "$SLUG" whatsapp --as $ADMIN >/dev/null 2>&1
chk B5.hand-switch-refused "B5 a feature cannot be switched by hand on the site (REST PUT as Administrator is refused)" "$(code_of "$T/admin" -X PUT "$FR/api/resource/Capxul%20Feature/stock" -d '{"enabled":1}') $(feat stock)" "403 off"
core hat revoke "$SLUG" member jonas@acme.test >/dev/null 2>&1
}

register 60 B6 checks_sites_60 "B5 B2"
checks_sites_60() {
echo "== Behaviour 6: the door (the CLI reaches Frappe as the calling person; their own permissions decide)"
SALES=sam@acme.test; HR=sana@acme.test; PROJ=pavel@acme.test; RUN=$(date +%s)
WORLD=""   # set to another world's name to drive that world (B9)
dj() { core "$@" ${WORLD:+--world $WORLD} --json; }   # a door command's JSON answer
for pair in "sales $SALES" "hr-manager $HR" "project-manager $PROJ"; do set -- $pair; core hat grant "$SLUG" "$1" "$2" >/dev/null 2>&1; done
wait_for 30 has_roles $SALES "['Accounts User', 'Sales Manager', 'Sales User']"; wait_for 30 has_roles $HR "['Employee', 'HR Manager', 'HR User']"; wait_for 30 has_roles $PROJ "['Employee', 'Projects Manager', 'Projects User']"
chk B6.new-hats-reach-site-as-roles "B6 three new hats (sales, hr-manager, project-manager) reached the site as roles" "$(roles_of $SALES | tr -d "'[] ,")$(roles_of $HR | tr -d "'[] ,")$(roles_of $PROJ | tr -d "'[] ,")" "AccountsUserSalesManagerSalesUserEmployeeHRManagerHRUserEmployeeProjectsManagerProjectsUser"
t0=$(ms); out=$(dj doc types $SLUG --as $ADMIN); ms_types=$(( $(ms) - t0 ))
NTYPES=$(echo "$out" | jget "d['data']['count']"); NDOC=$(echo "$out" | jget "len([t for t in d['data']['types'] if not t['child'] and not t['single']])")
[ "${NTYPES:-0}" -gt 100 ] && ok B6.discovery-document-types "B6 discovery: the admin-hat person reaches $NTYPES document types on a default site ($NDOC listable, ${ms_types}ms), from Frappe's own metadata" || bad B6.discovery-document-types "B6 doc types" "$out"
chk B6.discovery-by-feature "B6 discovery by feature: crm lists its own types for the sales person" "$(dj doc types $SLUG --as $SALES --feature crm | jget "sorted(t['doctype'] for t in d['data']['types'] if t['doctype'] in ('CRM Lead','CRM Deal','CRM Organization'))")" "['CRM Deal', 'CRM Lead', 'CRM Organization']"
chk B6.discovery-schema "B6 discovery: a schema comes from Frappe's metadata (CRM Lead has first_name, status)" "$(dj doc schema $SLUG "CRM Lead" --as $SALES | jget "all(f in [x['fieldname'] for x in d['data']['fields']] for f in ('first_name','status'))")" True
# sales: lead -> deal -> won -> customer in accounts -> invoice -> submit
LEAD=$(dj doc create $SLUG "CRM Lead" --as $SALES --data "{\"first_name\":\"Lena\",\"last_name\":\"Lead $RUN\",\"email\":\"lena$RUN@lead.test\",\"organization\":\"Lead Co $RUN\"}" | jget "d['data']['name']")
DEAL=$(dj doc call $SLUG crm.fcrm.doctype.crm_lead.crm_lead.convert_to_deal --as $SALES --args "{\"lead\":\"$LEAD\"}" | jget "d['data']")
[ -n "$LEAD" ] && [ -n "$DEAL" ] && ok B6.lead-to-deal "B6 sales person made lead $LEAD and converted it to deal $DEAL" || bad B6.lead-to-deal "B6 lead to deal" "lead=[$LEAD] deal=[$DEAL]"
dj doc update $SLUG "CRM Deal" "$DEAL" --as $SALES --data '{"status":"Won"}' >/dev/null
chk B6.won-deal-customer-in-accounts "B6 deal won: the customer is in accounts (read by the sales person)" "$(dj doc list $SLUG Customer --as $SALES --filters "[[\"crm_deal\",\"=\",\"$DEAL\"]]" --fields name,customer_type | jget "[(r['name'], r['customer_type']) for r in d['data']['rows']]")" "[('Lead Co $RUN', 'Company')]"
SI=$(dj doc create $SLUG "Sales Invoice" --as $SALES --data "{\"customer\":\"Lead Co $RUN\",\"company\":\"$COMPANY\",\"items\":[{\"item_name\":\"Consulting\",\"description\":\"Consulting\",\"qty\":1,\"rate\":900,\"income_account\":\"Sales - $ABBR\"}]}" | jget "d['data']['name']")
chk B6.created-document-is-draft "B6 newly created Sales Invoice $SI reads back as a draft" "$(dj doc get $SLUG "Sales Invoice" "$SI" --as $SALES | jget "d['data']['docstatus']")" 0; dj doc submit $SLUG "Sales Invoice" "$SI" --as $SALES >/dev/null
chk B6.sales-invoice-submitted-in-ledger "B6 sales person made and submitted Sales Invoice $SI; it is in the ledger (Debtors debited 900)" "$(dj doc get $SLUG "Sales Invoice" "$SI" --as $SALES | jget "d['data']['docstatus']") $(lst "$T/admin" "GL Entry" "[[\"voucher_no\",\"=\",\"$SI\"],[\"is_cancelled\",\"=\",0]]" '["account","debit"]' | jget "sum(g['debit'] for g in d['data'] if g['account'].startswith('Debtors'))")" "1 900.0"
# HR: employee, leave application, approve
EMP=$(dj doc create $SLUG Employee --as $HR --data "{\"first_name\":\"Eva\",\"last_name\":\"Employee $RUN\",\"gender\":\"Female\",\"date_of_birth\":\"1992-04-04\",\"date_of_joining\":\"2026-01-05\",\"company\":\"$COMPANY\",\"status\":\"Active\"}" | jget "d['data']['name']")
[ "$(dj doc list $SLUG "Holiday List Assignment" --as $HR | jget "d['data']['count']")" = 0 ] && { dj doc create $SLUG "Holiday List" --as $HR --data "{\"holiday_list_name\":\"Acme $RUN\",\"from_date\":\"2026-01-01\",\"to_date\":\"2026-12-31\"}" >/dev/null; HLA=$(dj doc create $SLUG "Holiday List Assignment" --as $HR --data "{\"applicable_for\":\"Company\",\"assigned_to\":\"$COMPANY\",\"holiday_list\":\"Acme $RUN\",\"from_date\":\"2026-01-01\"}" | jget "d['data']['name']"); dj doc submit $SLUG "Holiday List Assignment" "$HLA" --as $HR >/dev/null; }
LA=$(dj doc create $SLUG "Leave Application" --as $HR --data "{\"employee\":\"$EMP\",\"leave_type\":\"Leave Without Pay\",\"from_date\":\"2026-11-16\",\"to_date\":\"2026-11-17\",\"company\":\"$COMPANY\",\"status\":\"Open\"}" | jget "d['data']['name']")
dj doc update $SLUG "Leave Application" "$LA" --as $HR --data '{"status":"Approved"}' >/dev/null; dj doc submit $SLUG "Leave Application" "$LA" --as $HR >/dev/null
chk B6.hr-employee-and-approved-leave "B6 HR person made employee $EMP and leave application $LA, approved it (submitted, status Approved)" "$(dj doc get $SLUG "Leave Application" "$LA" --as $HR | jget "(d['data']['docstatus'], d['data']['status'])")" "(1, 'Approved')"
# projects: project, task, timesheet
TSDATE=$(python3 -c "import datetime,sys; print(datetime.date(2025,1,1)+datetime.timedelta(days=int(sys.argv[1])%400))" $RUN)
PRJ=$(dj doc create $SLUG Project --as $PROJ --data "{\"project_name\":\"B6 Website $RUN\"}" | jget "d['data']['name']")
TSK=$(dj doc create $SLUG Task --as $PROJ --data "{\"subject\":\"Design\",\"project\":\"$PRJ\"}" | jget "d['data']['name']")
TS=$(dj doc create $SLUG Timesheet --as $PROJ --data "{\"company\":\"$COMPANY\",\"time_logs\":[{\"activity_type\":\"Planning\",\"from_time\":\"$TSDATE 09:00:00\",\"hours\":2,\"project\":\"$PRJ\",\"task\":\"$TSK\"}]}" | jget "d['data']['name']")
[ -n "$PRJ" ] && [ -n "$TSK" ] && [ -n "$TS" ] && ok B6.project-task-timesheet "B6 project person made project $PRJ, task $TSK and timesheet $TS" || bad B6.project-task-timesheet "B6 projects" "$PRJ/$TSK/$TS"
# reports
GLF="{\"company\":\"$COMPANY\",\"from_date\":\"2026-01-01\",\"to_date\":\"2026-12-31\"}"   # (a variable: macOS bash 3.2 mis-parses \" inside nested $( ) )
chk B6.reports-run "B6 reports: the admin-hat person runs General Ledger and Trial Balance (rows come back)" "$(dj report run $SLUG "General Ledger" --as $ADMIN --filters "$GLF" | jget "d['data']['count']>5") $(dj report run $SLUG "Trial Balance" --as $ADMIN --filters "{\"company\":\"$COMPANY\",\"fiscal_year\":\"2026\",\"from_date\":\"2026-01-01\",\"to_date\":\"2026-12-31\"}" | jget "d['data']['count']>3") $(dj report list $SLUG --as $ADMIN | jget "d['data']['count']>50")" "True True True"
# refusals: a person without the role is refused, with a reason
refused() { local code; code=$(echo "$1" | jget "d['error']['code'] if not d['ok'] else 'OK'"); echo "$code"; }
chk B6.refusals-with-reason "B6 refused with a reason: budget-holder creating a CRM Lead, sales person creating an Employee, HR person creating a Sales Invoice, project person running the General Ledger" "$(refused "$(dj doc create $SLUG "CRM Lead" --as $BUDGET --data '{"first_name":"x"}')") $(refused "$(dj doc create $SLUG Employee --as $SALES --data '{"first_name":"x"}')") $(refused "$(dj doc create $SLUG "Sales Invoice" --as $HR --data '{"customer":"x"}')") $(refused "$(dj report run $SLUG "General Ledger" --as $PROJ --filters "$GLF")")" "FORBIDDEN FORBIDDEN FORBIDDEN FORBIDDEN"
chk B6.no-hat-and-unknown-person-refused "B6 a known person with no hat on this site (elena) has no door: NO_HAT; Administrator is not a person: UNKNOWN_PERSON" "$(refused "$(dj doc list $SLUG Customer --as elena@brightside.test)") $(refused "$(dj doc list $SLUG Customer --as Administrator)")" "NO_HAT UNKNOWN_PERSON"
chk B6.no-person-refused "B6 a door command with no --as is refused (the door never acts as Administrator)" "$(refused "$(dj doc list $SLUG Customer)")" NEEDS_PERSON
core feature off "$SLUG" projects --as $ADMIN >/dev/null 2>&1
off=$(dj doc list $SLUG Project --as $PROJ); offt=$(dj doc types $SLUG --as $PROJ --feature projects)
chk B6.switched-off-feature-refused "B6 a switched-off feature is refused through the door, with the feature's name in the reason" "$(echo "$off" | jget "(d['error']['code'], 'projects' in d['error']['reason'])") $(refused "$offt")" "('FEATURE_NOT_AVAILABLE', True) FEATURE_NOT_AVAILABLE"
chk B6.off-part-report-refused "B6 a report of a switched-off part (Project Summary, projects off) exits FEATURE_NOT_AVAILABLE through the door" "$(refused "$(dj report run $SLUG "Project Summary" --as $ADMIN --filters "{\"company\":\"$COMPANY\"}")")" FEATURE_NOT_AVAILABLE
core feature on "$SLUG" projects --as $ADMIN >/dev/null 2>&1
chk B6.switched-on-again-answers "B6 ... and switched on again it answers" "$(dj doc list $SLUG Project --as $PROJ | jget "d['ok']")" True
nx=$(dj doc next $SLUG "Sales Invoice" "$SI" --as $SALES); info "doc next: $(echo "$nx" | jget "(len(d['data']['connections']), len(d['data']['makers']))") (connections, make-methods) for a Sales Invoice"
t0=$(ms); core doc list $SLUG Customer --as $SALES --limit 5 >/dev/null; info "timing: doc list $(( $(ms) - t0 )) ms wall (node start included)"
t0=$(ms); core doc create $SLUG Project --as $PROJ --data "{\"project_name\":\"B6 timing $RUN\"}" >/dev/null; info "timing: doc create $(( $(ms) - t0 )) ms wall"
}

register 118 PRIVACY checks_sites_118 "B1"
checks_sites_118() {
echo "== Privacy: nothing phones home"
for s in acme beta gamma; do
  [ "$(curl -s -H "X-Frappe-Site-Name: $s.localhost" $FR/api/method/ping | jget "d['message']")" = pong ] || continue
  chk PRIVACY.nothing-phones-home "PRIVACY $s.localhost: no telemetry, no update check, no CRM usage-data screen, no enrichment, no vendor keys" "$( ( . "$HERE/frappe/bin/lib.sh"; inbench "bench --site $s.localhost execute capxul.privacy.status" 2>/dev/null | tail -1 ) | jget "(d['phoning_home'], d['enable_telemetry'], d['update_check_on'], d['crm_first_run_screen_pending'], d['domain_enrichment_on'], d['conf_keys_set'])")" "(False, 0, 0, 0, 0, [])"
done
fr "$T/admin" -o /dev/null -X PUT "$FR/api/resource/System%20Settings/System%20Settings" -d '{"enable_telemetry":1,"disable_system_update_notification":0}'
chk PRIVACY.share-usage-cannot-be-ticked "PRIVACY ticking 'Share usage data' (it writes enable_telemetry) cannot turn it on: stays 0, update check stays off" "$(fr "$T/admin" "$FR/api/resource/System%20Settings/System%20Settings" | jget "(d['data']['enable_telemetry'], d['data']['disable_system_update_notification'])")" "(0, 1)"
}

register 119 NAMES checks_sites_119 "B5"
checks_sites_119() {
echo "== Names: the site says Capxul, not Frappe or ERPNext (measured, not asserted)"
t0=$(ms); "$HERE/frappe/bin/find-names.sh" "$SLUG" $ADMIN jonas@acme.test > "$T/names.txt" 2>&1; names_ms=$(( $(ms) - t0 ))
FOUND=$(grep '^FOUND' "$T/names.txt" | tail -1)
if [ -n "$FOUND" ]; then ok NAMES.crawl "NAMES crawl as admin-hat and member-hat people finished in $((names_ms/1000)) s: $FOUND (shown = text a person reads; kept = copyright notice and third-party product names; covered = replaced by the person's own translations; internal = identifiers)"; else bad NAMES.crawl "NAMES crawl" "$(tail -c 300 "$T/names.txt")"; fi
grep -E '^(SHOWN|kept)' "$T/names.txt" | cut -c1-200 | while read -r l; do info "$l"; done
}

register 100 TL checks_sites_100 "B9"
checks_sites_100() {
TLDATE=$(wd)
TLPI=$(dj doc create $SLUG "Purchase Invoice" --as $BUDGET --data "{\"supplier\":\"$SUPPLIER\",\"company\":\"$COMPANY\",\"posting_date\":\"$TLDATE\",\"due_date\":\"$TLDATE\",\"items\":[{\"item_name\":\"Window cleaning\",\"description\":\"Window cleaning\",\"qty\":1,\"rate\":12.5,\"expense_account\":\"Administrative Expenses - $ABBR\"}]}" | jget "d['data']['name']")
dj doc submit $SLUG "Purchase Invoice" "$TLPI" --as $BUDGET >/dev/null
dj doc call $SLUG erpnext.accounts.doctype.payment_entry.payment_entry.get_payment_entry --as $BUDGET --args "{\"dt\":\"Purchase Invoice\",\"dn\":\"$TLPI\",\"bank_account\":\"$SAFE_ACCOUNT\"}" > "$T/tlpe.json"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1]))["data"]; d["paid_from"]=sys.argv[2]; print(json.dumps({k:v for k,v in d.items() if not k.startswith("__")}))' "$T/tlpe.json" "$SAFE_ACCOUNT" > "$T/tlpe.data"
TLPE=$(dj doc create $SLUG "Payment Entry" --as $BUDGET --data @"$T/tlpe.data" | jget "d['data']['name']")
TLSUB=$(dj doc submit $SLUG "Payment Entry" "$TLPE" --as $BUDGET)
TLAPR=$(echo "$TLSUB" | jget "d['data']['approval']")
chk TL.doc-submit-safe-payment-held-signer-named "TL doc submit of Safe Payment Entry $TLPE through the door: held, with an approval id, awaiting the budget holder's signature" \
  "$(echo "$TLSUB" | jget "(d['data']['held'], d['data']['approval'].startswith('apr_'), d['data']['awaiting'])")" "(True, True, '$BUDGET')"
chk TL.held-payment-posts-no-ledger-line "TL while held: the entry is a draft and has no ledger line" \
  "$(dj doc get $SLUG "Payment Entry" "$TLPE" --as $BUDGET | jget "d['data']['docstatus']") $(gl_of "$TLPE" | jget "len(d['data'])")" "0 0"
dj approval sign $SLUG "$TLAPR" --as $BUDGET > "$T/tlsign.json"
# the site posts when the chain's PaymentSent reaches it through Core's outbox, so it lands a moment after the signature
wait_for 20 bash -c "[ \"\$(node --experimental-strip-types --no-warnings '$HERE/core/src/main.ts' doc get $SLUG 'Payment Entry' '$TLPE' --as $BUDGET --json | python3 -c 'import json,sys; print(json.load(sys.stdin)[\"data\"][\"docstatus\"])')\" = 1 ]"
chk TL.signed-payment-posts-once "TL after the signature lands: the entry is submitted and posted once (one credit to the Safe account of 12.5)" \
  "$(dj doc get $SLUG "Payment Entry" "$TLPE" --as $BUDGET | jget "d['data']['docstatus']") $(gl_of "$TLPE" | jget "[(r['debit'], r['credit']) for r in d['data'] if r['account']=='$SAFE_ACCOUNT']")" "1 [(0.0, 12.5)]"
}
