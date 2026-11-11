# The thin line's checks that run.sh does not already make (evals/thin-line.md). Sourced by run.sh at the end of B9, so
# it uses run.sh's helpers (chk, ok, bad, dj, core, jget, lst, gl_of, sum_of, sbal) and state ($SLUG, $SITE, $W2, ...).
# Not a script of its own: `run.sh --list` reads the check names in this file too.

echo "== Thin line: a Safe payment held through the door; a world saved untouched; a restored world's show and export"

# acc:doc.submit/2: a Payment Entry from the Safe is held, not posted, and the signer is named; after the signature it posts once.
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
chk TL.signed-payment-posts-once "TL after the signature lands: the entry is submitted and posted once (one credit to the Safe account of 12.5)" \
  "$(dj doc get $SLUG "Payment Entry" "$TLPE" --as $BUDGET | jget "d['data']['docstatus']") $(gl_of "$TLPE" | jget "[(r['debit'], r['credit']) for r in d['data'] if r['account']=='$SAFE_ACCOUNT']")" "1 [(0.0, 12.5)]"

# acc:world.snapshot.save/1: a snapshot saves everything that makes the world and leaves it untouched.
TLS0=$(sum_of $SITE); TLB0=$(sbal $RPC); TLT0=$(core world clock show main --json | jget "d['data']['time'][:16]"); TLN0=$(wc -l < "$REC")
TLSAVE=$(dj world snapshot save main --as operator --name "tl-$RUN")
TLSNAP=$(echo "$TLSAVE" | jget "d['data']['id']")
chk TL.snapshot-save-prints-epoch-and-record-seq "TL world snapshot save prints the world's epoch and its record position (the entries before the save)" \
  "$(echo "$TLSAVE" | jget "(isinstance(d['data']['epoch'], int) and d['data']['epoch'] >= 1, d['data']['recordSeq'])")" "(True, $TLN0)"
chk TL.snapshot-save-leaves-world-untouched "TL after the save the world is as it was: documents, ledger, hats, features and events on the site, the Safe's balance, the clock" \
  "$(sum_of $SITE) $(sbal $RPC) $(core world clock show main --json | jget "d['data']['time'][:16]")" "$TLS0 $TLB0 $TLT0"
chk TL.snapshot-save-record-gains-only-the-save "TL the world's record gained the save's entry and nothing else; snapshot list lists it" \
  "$(python3 -c 'import json,sys; rs=[json.loads(l) for l in open(sys.argv[1])][int(sys.argv[2]):]; print([r["command"] for r in rs if r["command"]!="world clock show"][:1], len([r for r in rs if r["command"]=="world snapshot save"]))' "$REC" "$TLN0") $(dj world snapshot list main | jget "'$TLSNAP' in [s['id'] for s in d['data']['snapshots']]")" "['world snapshot save'] 1 True"

# acc:world.show/1: a world restored into another names its parent.
chk TL.world-show-names-parent "TL world show $W2 names its parent world, the snapshot and the record position it was restored from" \
  "$(core world show $W2 --json | jget "(d['data']['parentWorld'], d['data']['parentSnapshot'], d['data']['parentSeq'])")" "('main', '$SNAP', $SREC)"

# acc:record.export/1: an export carries the lineage and every entry once.
TLX="$T/tl-export.jsonl"; TLXOUT=$(core record export $W2 --out "$TLX" --json)
chk TL.export-prints-lines-and-lineage "TL record export $W2 prints its line count and a lineage naming main" \
  "$(echo "$TLXOUT" | jget "(d['data']['lines'], d['data']['lineage']['parentWorld'], d['data']['lineage']['parentSnapshot'])")" "($(wc -l < "$TLX" | tr -d ' '), 'main', '$SNAP')"
chk TL.export-lineage-first-then-every-entry-once-in-order "TL the file's first line is the lineage; the entries follow in order, each once: the world's whole record up to the export" \
  "$(python3 -c '
import json,sys
ls=[json.loads(l) for l in open(sys.argv[1])]; rec=[json.loads(l) for l in open(sys.argv[2])]
e=ls[1:]
print(ls[0]["lineage"]["parentWorld"], [r["seq"] for r in e]==list(range(1,len(e)+1)), len({r["id"] for r in e})==len(e), [r["id"] for r in e]==[r["id"] for r in rec[:-1]] and rec[-1]["command"]=="record export")' "$TLX" "$HERE/core/state/worlds/$W2/record/$W2.jsonl")" "main True True True"
