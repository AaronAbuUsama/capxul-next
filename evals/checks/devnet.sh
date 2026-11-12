# devnet: sourced by spikes/skeleton/run.sh; shared helpers and scenario state come from the harness.

register 70 B7 checks_devnet_70 "B6 B3"
checks_devnet_70() {
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
chk B7.non-admin-cannot-move-clock "B7 a person who is not the world's admin cannot move its clock (refused, nothing changed)" "$(refused "$(dj world clock set main 2026-03-02T09:00:00Z --as $ADMIN)")" NOT_WORLD_ADMIN
t0=$(ms); out=$(dj world clock set main 2026-03-02T09:00:00Z --as operator); set_ms=$(( $(ms) - t0 ))
chk B7.clock-set-in-the-past-chain-and-sites-follow "B7 world clock set to 2 March 2026 (in the past): every site and the chain show it" "$(dj world clock show main | jget "(d['data']['time'][:10], d['data']['chainLatestBlock'][:10], sorted(set(s['today'] for s in d['data']['sites'])))")" "('2026-03-02', '2026-03-02', ['2026-03-02'])" "${set_ms}ms"
for old in $(dj doc list $SLUG "Accounting Period" --as $ADMIN --filters '[["start_date","=","2026-03-01"]]' | jget "' '.join(r['name'] for r in d['data']['rows'])"); do dj doc delete $SLUG "Accounting Period" "$old" --as $ADMIN >/dev/null; done   # a period left by an earlier run
PERIODS=("2026-03-02")
pay_at() { read -r si pi pe tx <<<"$(mkpay "$1")"; PES+=("$pe"); TXS+=("$tx"); SIS+=("$si"); [ -n "$tx" ] && ok B7.payment-signed-by-key-at-world-time "B7 $(wd): invoice $si, bill $pi, payment $pe signed by key through approval sign, tx $tx" || bad B7.payment-signed-by-key-at-world-time "B7 payment at $(wd)" "no tx: $(cat "$T/sign.json" | head -c 300)"; }
PES=(); TXS=(); SIS=()
pay_at 101.00
for step in 10d 10d 9d; do
  t0=$(ms); out=$(dj world clock advance main $step --as operator); adv_ms=$(( $(ms) - t0 )); PERIODS+=("$(wd)")
  [ "$(echo "$out" | jget "d['ok']")" = True ] || bad B7.clock-advance "B7 advance $step" "$(echo "$out" | head -c 300)"
  info "B7 advanced $step in ${adv_ms}ms: $(echo "$out" | jget "(d['data']['stopsPerSite'], d['data']['jobsRun'])") (stops per site, scheduled jobs run)"
  pay_at $((100 + ${#PES[@]})).50
done
chk B7.world-at-31-march-all-agree "B7 the world is at 31 March after three advances; every site of the world and the chain agree" "$(dj world clock show main | jget "(d['data']['time'][:10], d['data']['chainLatestBlock'][:10], sorted(set(s['today'] for s in d['data']['sites'])), len(d['data']['sites'])>=3)")" "('2026-03-31', '2026-03-31', ['2026-03-31'], True)"
chk B7.ledger-dates-are-world-dates "B7 the ledger's dates are the world's dates: each payment and each sales invoice posted on the day the world was at" "$(lst "$T/admin" "GL Entry" "[[\"voucher_no\",\"in\",$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "${PES[@]}" "${SIS[@]}")],[\"is_cancelled\",\"=\",0]]" '["voucher_type","posting_date"]' | jget "sorted(set((g['voucher_type'],g['posting_date']) for g in d['data']))")" "[('Payment Entry', '2026-03-02'), ('Payment Entry', '2026-03-12'), ('Payment Entry', '2026-03-22'), ('Payment Entry', '2026-03-31'), ('Sales Invoice', '2026-03-02'), ('Sales Invoice', '2026-03-12'), ('Sales Invoice', '2026-03-22'), ('Sales Invoice', '2026-03-31')]"
blocks=""; for tx in "${TXS[@]}"; do n=$(cast receipt "$tx" blockNumber --rpc-url $RPC); blocks+="$(python3 -c "import datetime,sys;print(datetime.datetime.fromtimestamp(int(sys.argv[1]),datetime.timezone.utc).date())" "$(cast block "$n" -f timestamp --rpc-url $RPC)") "; done   # python, not date -r, which only macOS reads as an epoch
chk B7.chain-block-times-are-world-dates "B7 the chain's block times agree: each payment's block carries the world's date" "$blocks" "2026-03-02 2026-03-12 2026-03-22 2026-03-31 "
chk B7.payment-reference-date-from-block "B7 the payment entries took their reference date from the block (chain time, not host time)" "$(for pe in "${PES[@]}"; do pe_field "$pe" reference_date; done | tr '\n' ' ')" "2026-03-02 2026-03-12 2026-03-22 2026-03-31 "
# a recurring document and scheduled jobs: made by the scheduler's own rules at each day crossed
close_body=$(python3 -c 'import json,sys; print(json.dumps({"period_name":"March 2026 close "+sys.argv[1],"start_date":"2026-03-01","end_date":"2026-03-31","company":sys.argv[2],"closed_documents":[{"document_type":t,"closed":1} for t in ("Sales Invoice","Purchase Invoice","Payment Entry","Journal Entry")]}))' "$RUN" "$COMPANY")
AP=$(dj doc create $SLUG "Accounting Period" --as $ADMIN --data "$close_body" | jget "d['data']['name']")
[ -n "$AP" ] && ok B7.month-closed "B7 the month is closed: Accounting Period $AP (Sales Invoice, Purchase Invoice, Payment Entry, Journal Entry closed for March)" || bad B7.month-closed "B7 close the month" "no accounting period"
chk B7.closed-month-invoice-refused "B7 a Sales Invoice dated in the closed month is refused" "$(dj doc create $SLUG "Sales Invoice" --as $SALES --data "{\"customer\":\"Lead Co $RUN\",\"company\":\"$COMPANY\",\"set_posting_time\":1,\"posting_date\":\"2026-03-15\",\"due_date\":\"2026-03-15\",\"items\":[{\"item_name\":\"Late\",\"qty\":1,\"rate\":1,\"income_account\":\"Sales - $ABBR\"}]}" | jget "d['error']['code'] if not d['ok'] else d['data']['name']")" INVALID
# the world moves back to the host's time, closes the period for the next run
dj doc delete $SLUG "Accounting Period" "$AP" --as $ADMIN >/dev/null 2>&1
core world clock reset main --as operator >/dev/null 2>&1
chk B7.clock-reset-to-host-time "B7 clock reset: the chain and every site are back on the host's time" "$(dj world clock show main | jget "(d['data']['offsetMs'], sorted(set(s['today'] for s in d['data']['sites'])) == [__import__('datetime').date.today().isoformat()], d['data']['chainLatestBlock'][:7] == d['data']['time'][:7])")" "(0, True, True)"
}

register 80 B8 checks_devnet_80 "B7"
checks_devnet_80() {
echo "== Behaviour 8: the record (one entry per command, in order; a money movement can be followed by its trace id)"
login_admin   # a cookie session does not survive the world's clock being moved (a finding): sign in again before the admin REST reads below
NREC=$(( $(wc -l < "$REC") - REC0 )); NCALLS=$(wc -l < "$CALLS" | tr -d " ")
chk B8.one-record-entry-per-command "B8 the record has one entry per command of this run (every command, not only the successful ones)" "$NREC" "$NCALLS"
chk B8.sequence-gap-free-and-hash-chained "B8 in order: sequence numbers run 1..n with no gap and each line carries the hash of the one before (tamper-evident)" "$(core record tail main --json --n 1 | jget "d['data']['chainOk']")" True
chk B8.world-time-in-entries "B8 world time is in the entries: the March payments are recorded at their world dates" "$(python3 -c '
import json,sys
rs=[json.loads(l) for l in open(sys.argv[1])][int(sys.argv[2]):]   # this run only
print(sorted(set(r["world_time"][:10] for r in rs if r["command"]=="approval sign" and r["world_time"].startswith("2026-03"))))' "$REC" "$REC0")" "['2026-03-02', '2026-03-12', '2026-03-22', '2026-03-31']"
# follow the last payment: command -> chain transaction -> ledger entry, by trace id
LAST_TX=${TXS[3]}; SIGN_TRACE=$(python3 -c '
import json,sys
for l in open(sys.argv[1]):
    r=json.loads(l)
    if r["command"]=="approval sign" and any(t["hash"]==sys.argv[2] for t in r["changes"]["tx"]): print(r["trace"])' "$REC" "$LAST_TX")
chk B8.record-names-chain-transaction "B8 the command's record names the chain transaction (trace $SIGN_TRACE -> $LAST_TX)" "$([ -n "$SIGN_TRACE" ] && echo found)" found
chk B8.ledger-entries-carry-trace-id "B8 ... and the ledger entries carry the same trace id (GL Entry.capxul_trace), for the payment's voucher" "$(lst "$T/admin" "GL Entry" "[[\"capxul_trace\",\"=\",\"$SIGN_TRACE\"]]" '["voucher_no","voucher_type"]' | jget "sorted(set((g['voucher_type'], g['voucher_no']==\"${PES[3]}\") for g in d['data']))")" "[('Payment Entry', True)]"
chk B8.payment-timeline-carries-trace-id "B8 ... and the Payment Entry's own timeline holds the trace id (a Comment)" "$(lst "$T/admin" Comment "[[\"reference_doctype\",\"=\",\"Payment Entry\"],[\"reference_name\",\"=\",\"${PES[3]}\"],[\"content\",\"like\",\"%$SIGN_TRACE%\"]]" '["name"]' | jget "len(d['data'])>=1")" True
chk B8.core-log-carries-trace-id "B8 ... and Core's log has the call under that trace id" "$(grep -c "trace $SIGN_TRACE" "$HERE/core/state/core.log" | awk '{print ($1>0)?"yes":"no"}')" yes
chk B8.record-show-by-trace-id "B8 record show finds the command by its trace id" "$(core record show "$SIGN_TRACE" --json | jget "d['data']['command']")" "approval sign"
OUT_EXPORT="$T/export.jsonl"; core record export main --out "$OUT_EXPORT" >/dev/null
chk B8.export-one-file-line-by-line "B8 record export produces one file: a header line and every record, readable line by line" "$(python3 -c '
import json,sys
ls=[json.loads(l) for l in open(sys.argv[1])]
print(ls[0]["type"], ls[0]["chain_ok"], len(ls)-1==ls[0]["count"])' "$OUT_EXPORT")" "capxul-record-export True True"
leaks=0; for k in $(python3 -c "import json;p=json.load(open('$HERE/core/people.json'));print(' '.join([p['operator']['privateKey']]+[x['privateKey'] for x in p['people']]))") "$SKELETON_SECRET"; do n=$(cat "$HERE"/core/state/record/*.jsonl "$OUT_EXPORT" | grep -c -F "$k"); leaks=$((leaks+n)); done
chk B8.no-secret-in-record "B8 no secret in the record or the export (grep for every test key and the shared secret)" "$leaks" 0
}

register 90 B9 checks_devnet_90 "B8"
checks_devnet_90() {
echo "== Behaviour 9: world snapshots (a world is saved, restored beside the original as a second world, and restored in place)"
W2=w2; core world delete $W2 --as operator >/dev/null 2>&1      # a world left by an earlier run
dj world clock set main 2026-06-01T10:00:00Z --as operator >/dev/null
sbal() { cast call "$USDC" "balanceOf(address)(uint256)" "$SAFE" --rpc-url "$1" | awk '{print $1}'; }
sum_of() { "$HERE/frappe/bin/bench-exec.sh" "$1" capxul.world.summary | grep -a CAPXUL_RESULT: | tail -1 | sed "s/.*CAPXUL_RESULT://" | python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); [d.pop(k) for k in ("site","world","now")]; print(json.dumps(d,sort_keys=True))'; }
pes() { sum_of "$1" | jget "d['docs']['Payment Entry']"; }
S0=$(sum_of $SITE); B0=$(sbal $RPC); P0=$(echo "$S0" | jget "d['docs']['Payment Entry']")
t0=$(ms); out=$(dj world snapshot save main --as operator --name "run-$RUN"); save_ms=$(( $(ms) - t0 ))
SNAP=$(echo "$out" | jget "d['data']['id']"); SNAP_MB=$(echo "$out" | jget "round(d['data']['bytes']/1e6,1)")
[ -n "$SNAP" ] && ok B9.snapshot-saved "B9 world main saved as $SNAP: every company, the whole chain, Core's state, the clock, record position $(echo "$out" | jget "d['data']['record']['count']"); ${save_ms}ms, ${SNAP_MB} MB" || bad B9.snapshot-saved "B9 snapshot save" "$out"
chk B9.snapshot-list "B9 snapshot list shows it with its world, name and record position" "$(dj world snapshot list main | jget "[(s['world'], s['name']) for s in d['data']['snapshots'] if s['id']=='$SNAP']")" "[('main', 'run-$RUN')]"
chk B9.non-operator-cannot-save-or-restore "B9 a person who is not the operator cannot save or restore a world" "$(refused "$(dj world snapshot save main --as $ADMIN)") $(refused "$(dj world snapshot restore $SNAP --as $ADMIN --into zz)")" "NOT_WORLD_ADMIN NOT_WORLD_ADMIN"
core world clock reset main --as operator >/dev/null
t0=$(ms); out=$(dj world snapshot restore $SNAP --as operator --into $W2 --only $SLUG); into_ms=$(( $(ms) - t0 ))
[ "$(echo "$out" | jget "d['ok']")" = True ] && ok B9.restore-into-new-world "B9 restored into a NEW world $W2 beside the original (own chain, own Core, site $SLUG.$W2.localhost) in ${into_ms}ms: $(echo "$out" | jget "d['data']['phasesMs']")" || bad B9.restore-into-new-world "B9 restore into" "$out"
W2_RPC=$(core world show $W2 --json | jget "'http://127.0.0.1:%d' % d['data']['anvilPort']")
chk B9.new-world-same-documents-ledger-hats-features "B9 the new world has the same documents, ledger balances, hats, features and event position as the saved one" "$(sum_of $SLUG.$W2.localhost)" "$S0"
chk B9.new-world-same-safe-balance "B9 the new world's chain has the same balance in the company's Safe" "$(sbal $W2_RPC)" "$B0" "$B0 units"
chk B9.new-world-clock-resumed "B9 the new world's clock resumed at the saved world time (1 June), on its chain and its site; the original is on the host's time" "$(dj world clock show $W2 | jget "(d['data']['time'][:10], d['data']['chainLatestBlock'][:10] <= '2026-11-10', [s['today'] for s in d['data']['sites']])") $(core world clock show main --json | jget "d['data']['offsetMs']")" "('2026-06-01', True, ['2026-06-01']) 0"
chk B9.restored-site-door-works "B9 the restored site signs people in through the new world's Core and the door works there (hannah lists invoices as herself)" "$(dj doc list $SLUG "Sales Invoice" --as $ADMIN --world $W2 --limit 2 | jget "d['ok']")" True
chk B9.world-list-shows-origin "B9 the world list shows both worlds and where the new one came from" "$(core world list --json | jget "sorted((w['name'], (w['from'] or {}).get('snapshot','')) for w in d['data']['worlds'])")" "[('main', ''), ('$W2', '$SNAP')]"
# a payment in the new world does not appear in the old one, and the reverse
B1=$(sbal $RPC)
WORLD=$W2; read -r si pi pe tx <<<"$(mkpay 7.25 $W2)"; WORLD=""
[ -n "$tx" ] && ok B9.payment-made-in-new-world "B9 a payment made in $W2 (invoice $si, payment $pe, tx $tx)" || bad B9.payment-made-in-new-world "B9 payment in the new world" "no tx"
chk B9.new-world-payment-not-in-old "B9 ... is in the new world ($(( P0 + 1 )) payment entries, Safe down 7.25) and not in the old ($P0, unchanged)" "$(pes $SLUG.$W2.localhost) $(( B0 - $(sbal $W2_RPC) )) $(pes $SITE) $(sbal $RPC)" "$((P0+1)) 7250000 $P0 $B0"
read -r si pi pe tx <<<"$(mkpay 3.10 main)"
chk B9.old-world-payment-not-in-new "B9 a payment made in the old world is not in the new one (old $((P0+1)), new still $((P0+1)))" "$(pes $SITE) $(pes $SLUG.$W2.localhost) $(( B0 - $(sbal $RPC) ))" "$((P0+1)) $((P0+1)) 3100000"
# lineage in the record
SREC=$(dj world snapshot list main | jget "[s['record'] for s in d['data']['snapshots'] if s['id']=='$SNAP'][0]")
chk B9.new-world-record-begins-with-old-then-lineage "B9 the new world's record begins with the old world's up to the snapshot, then says which snapshot it came from; its own commands follow" "$(python3 -c '
import json,sys
rs=[json.loads(l) for l in open(sys.argv[1])]
i=[k for k,r in enumerate(rs) if r.get("lineage")]
print(len(i), rs[i[0]]["lineage"]["snapshot"]==sys.argv[2], rs[i[0]]["seq"]==int(sys.argv[3])+1, any(r["command"]=="approval sign" for r in rs[i[0]+1:]))' "$HERE/core/state/worlds/$W2/record/$W2.jsonl" "$SNAP" "$SREC")" "1 True True True"
chk B9.old-world-record-says-it-made-new "B9 the old world's record says it made the new one (restore --into) and its own trace is not in the new world's record" "$(python3 -c '
import json,sys
a=[json.loads(l) for l in open(sys.argv[1])]; b=[json.loads(l) for l in open(sys.argv[2])]
print(any(r["command"]=="world snapshot restore" and r["changes"].get("lineage",{}).get("intoWorld")==sys.argv[3] for r in a), not any(r["id"]==a[-1]["id"] for r in b))' "$REC" "$HERE/core/state/worlds/$W2/record/$W2.jsonl" "$W2")" "True True"
# restore in place: main goes back to the saved moment
t0=$(ms); out=$(dj world snapshot restore $SNAP --as operator --in-place); inplace_ms=$(( $(ms) - t0 ))
[ "$(echo "$out" | jget "d['ok']")" = True ] && ok B9.restore-in-place "B9 restore --in-place of the whole world main in ${inplace_ms}ms: $(echo "$out" | jget "d['data']['phasesMs']")" || bad B9.restore-in-place "B9 restore in place" "$out"
chk B9.in-place-state-back-at-saved-moment "B9 in place: main is back at the saved moment (the payment made after the save is gone: documents, ledger, hats, features, balance)" "$(sum_of $SITE | python3 -c 'import sys; print(sys.stdin.read().strip())') $(sbal $RPC)" "$S0 $B0"
chk B9.in-place-clock-back-at-saved-time "B9 in place: the world clock is back at the saved world time on the chain and on all three sites" "$(core world clock show main --json | jget "(d['data']['time'][:10], d['data']['chainLatestBlock'][:10] <= '2026-11-10', sorted(set(s['today'] for s in d['data']['sites'])))")" "('2026-06-01', True, ['2026-06-01'])"
chk B9.in-place-record-not-rewound "B9 in place: the record of main was not rewound (it grew), and says what it was restored from" "$(python3 -c '
import json,sys
rs=[json.loads(l) for l in open(sys.argv[1])]
r=[x for x in rs if x["command"]=="world snapshot restore" and x["changes"].get("lineage",{}).get("intoWorld")=="main"]
print(len(r)>=1, rs[-1]["seq"]==len(rs))' "$REC")" "True True"
core world clock reset main --as operator >/dev/null; login_admin
info "B9 measured: save ${save_ms}ms, ${SNAP_MB} MB; restore into a new world (1 company) ${into_ms}ms; restore in place (whole world) ${inplace_ms}ms"
}

register 102 TL checks_devnet_102 "B9"
checks_devnet_102() {
# acc:world.snapshot.save/c-69e4dbcdf13e3750: a snapshot saves everything that makes the world and leaves it untouched.
TLS0=$(sum_of $SITE); TLB0=$(sbal $RPC); TLT0=$(core world clock show main --json | jget "d['data']['offsetMs']"); TLN0=$(wc -l < "$REC")
TLSAVE=$(dj world snapshot save main --as operator --name "tl-$RUN")
TLSNAP=$(echo "$TLSAVE" | jget "d['data']['id']")
chk TL.snapshot-save-prints-epoch-and-record-seq "TL world snapshot save prints the world's epoch and its record position (the entries before the save)" \
  "$(echo "$TLSAVE" | jget "(isinstance(d['data']['epoch'], int) and d['data']['epoch'] >= 1, d['data']['recordSeq'])")" "(True, $TLN0)"
chk TL.snapshot-save-leaves-world-untouched "TL after the save the world is as it was: documents, ledger, hats, features and events on the site, the Safe's balance, the clock's offset" \
  "$(sum_of $SITE) $(sbal $RPC) $(core world clock show main --json | jget "d['data']['offsetMs']")" "$TLS0 $TLB0 $TLT0"
chk TL.snapshot-save-record-gains-only-the-save "TL the world's record gained the save's entry and nothing else; snapshot list lists it" \
  "$(python3 -c 'import json,sys; rs=[json.loads(l) for l in open(sys.argv[1])][int(sys.argv[2]):]; print([r["command"] for r in rs if r["command"]!="world clock show"][:1], len([r for r in rs if r["command"]=="world snapshot save"]))' "$REC" "$TLN0") $(dj world snapshot list main | jget "'$TLSNAP' in [s['id'] for s in d['data']['snapshots']]")" "['world snapshot save'] 1 True"

# acc:world.show/c-6aa449b0c9f7abaf: a world restored into another names its parent.
chk TL.world-show-names-parent "TL world show $W2 names its parent world, the snapshot and the record position it was restored from" \
  "$(core world show $W2 --json | jget "(d['data']['parentWorld'], d['data']['parentSnapshot'], d['data']['parentSeq'])")" "('main', '$SNAP', $SREC)"

# acc:record.export/c-bd1acd26102d2d92: an export carries the lineage and every entry once.
TLX="$T/tl-export.jsonl"; TLXOUT=$(core record export $W2 --out "$TLX" --json)
chk TL.export-prints-lines-and-lineage "TL record export $W2 prints its line count and a lineage naming main" \
  "$(echo "$TLXOUT" | jget "(d['data']['lines'], d['data']['lineage']['parentWorld'], d['data']['lineage']['parentSnapshot'])")" "($(wc -l < "$TLX" | tr -d ' '), 'main', '$SNAP')"
chk TL.export-lineage-first-then-every-entry-once-in-order "TL the file's first line is the lineage; the entries follow in order, each once: the world's whole record up to the export" \
  "$(python3 -c '
import json,sys
ls=[json.loads(l) for l in open(sys.argv[1])]; rec=[json.loads(l) for l in open(sys.argv[2])]
e=ls[1:]
print(ls[0]["lineage"]["parentWorld"], [r["seq"] for r in e]==list(range(1,len(e)+1)), len({r["id"] for r in e})==len(e), [r["id"] for r in e]==[r["id"] for r in rec[:-1]] and rec[-1]["command"]=="record export")' "$TLX" "$HERE/core/state/worlds/$W2/record/$W2.jsonl")" "main True True True"

# acc:world.clock.warp/c-2bceeaa41942995d: a warp moves the chain and every site together and runs what fell due (Capxul's daily job, once a day).
TLW0=$(core world clock show main --json | jget "d['data']['time']")
TLWARP=$(dj world clock advance main 7d --as operator)
TLWNOW=$(echo "$TLWARP" | jget "d['data']['worldNow']")
chk TL.warp-moves-chain-and-every-site-a-week-on "TL world clock advance main 7d: worldNow is a week on, and the chain and every site of the world show that day" \
  "$(python3 -c 'import sys,datetime as t; a,b=[t.datetime.fromisoformat(x.replace("Z","+00:00")) for x in sys.argv[1:3]]; print(round((b-a).total_seconds()/86400, 3))' "$TLW0" "$TLWNOW") $(dj world clock show main | jget "(d['data']['chainLatestBlock'][:10], sorted(set(s['today'] for s in d['data']['sites'])))")" \
  "7.0 ('${TLWNOW:0:10}', ['${TLWNOW:0:10}'])"
chk TL.warp-ran-daily-job-once-each-day "TL $SITE shows Capxul's daily job ran once for each of the seven days warped over" \
  "$(lst "$T/admin" Comment "[[\"reference_doctype\",\"=\",\"Capxul Settings\"],[\"content\",\"like\",\"capxul daily job ran for %\"]]" '["content"]' | jget "sorted(x for x in (r['content'][-10:] for r in d['data']) if '${TLW0:0:10}' < x <= '${TLWNOW:0:10}')")" \
  "$(python3 -c 'import sys,datetime as t; d=t.date.fromisoformat(sys.argv[1][:10]); print(sorted(str(d+t.timedelta(days=i)) for i in range(1,8)))' "$TLW0")"
chk TL.warp-backwards-refused "TL a warp backwards (-1d) is refused as invalid input and moves nothing" \
  "$(refused "$(dj world clock advance main -1d --as operator)") $(core world clock show main --json | jget "d['data']['time'][:10]")" "INVALID_INPUT ${TLWNOW:0:10}"
core world clock reset main --as operator >/dev/null

# acc:world.create/c-52e22ec1e2a6c1cc: a new world runs with its clock and a record that begins with its birth.
TLWN=tlfrozen; core world delete $TLWN --as operator >/dev/null 2>&1   # left by an earlier run
TLWC=$(dj world create $TLWN --clock frozen --template empty --as operator)
chk TL.world-create-runs-frozen "TL world create $TLWN --clock frozen --template empty: the world runs, on a frozen clock, at epoch 1, with no company" \
  "$(echo "$TLWC" | jget "(d['data']['state'], d['data']['clockMode'], d['data']['epoch'], d['data']['companies'])")" "('running', 'frozen', 1, [])"
TLC1=$(core world clock show $TLWN --json | jget "d['data']['time']"); sleep 2
chk TL.world-frozen-clock-holds "TL its clock holds while the host's moves (two reads 2 s apart agree) and the chain is at its epoch" \
  "$(core world clock show $TLWN --json | jget "(d['data']['time'], d['data']['chainLatestBlock'][:16])")" "('$TLC1', '${TLC1:0:16}')"
chk TL.world-record-begins-with-birth "TL world show $TLWN says running and frozen; its record's first entry is its birth, the only one, and the hash chain holds" \
  "$(core world show $TLWN --json | jget "(d['data']['state'], d['data']['clockMode'], d['data']['recordHead'] >= 1)") $(core record tail $TLWN --json --n 50 | jget "(d['data']['chainOk'], d['data']['records'][0]['seq'], d['data']['records'][0]['command'], d['data']['records'][0]['born']['clockMode'], sum(1 for r in d['data']['records'] if 'born' in r))")" \
  "('running', 'frozen', True) (True, 1, 'world create', 'frozen', 1)"
core world delete $TLWN --as operator >/dev/null 2>&1
}
