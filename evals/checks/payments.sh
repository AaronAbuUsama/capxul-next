# payments: sourced by spikes/skeleton/run.sh; shared helpers and scenario state come from the harness.

register 30 B3 checks_payments_30 "B2"
checks_payments_30() {
echo "== Behaviour 3: paying a document is the normal Frappe flow"
sso $ADMIN "$T/hannah" && sso $BUDGET "$T/marcus" || bad B3.payer-sign-in "B3 sign-in of the payer" "sso failed"
fr "$T/hannah" -X POST $FR/api/resource/Supplier -d "{\"supplier_name\":\"$SUPPLIER\",\"supplier_group\":\"All Supplier Groups\",\"capxul_wallet_address\":\"$SUPPLIER_ADDR\"}" > "$T/sup.json"
chk B3.admin-hat-person-creates-supplier "B3 admin-hat person creates a supplier with a wallet address (their own session, not Administrator)" "$(fr "$T/hannah" "$FR/api/resource/Supplier/${SUPPLIER// /%20}" | jget "d['data']['capxul_wallet_address']")" "$SUPPLIER_ADDR"
read -r PI PE <<<"$(mk_pe "$T/marcus" 125.50)"
[ -n "${PE:-}" ] && ok B3.budget-holder-makes-invoice-and-payment-entry "B3 budget-holder (session of $BUDGET) made Purchase Invoice $PI and a Payment Entry $PE from the Safe account" || { bad B3.budget-holder-makes-invoice-and-payment-entry "B3 make invoice + payment entry" "$(tail -c 300 "$T/pe.json")"; exit 1; }
chk B3.invoice-outstanding-before-paying "B3 the invoice has 125.5 outstanding before paying" "$(pi_outstanding "$PI")" 125.5
ans=$(request "$T/marcus" "$PE"); APR=$(echo "$ans" | jget "d['message']['approval_url']"); APR=${APR##*/}
chk B3.submit-waits-for-signature "B3 Submit asks Capxul: the entry shows waiting for a signature" "$(echo "$ans" | jget "d['message']['status']")" "Waiting for signature" "approval $APR"
chk B3.still-a-draft-while-waiting "B3 still a draft while waiting" "$(pe_field "$PE" docstatus) $(pe_field "$PE" capxul_status)" "0 Waiting for signature"
B_TO=$(usdc $SUPPLIER_ADDR); B_SAFE=$(usdc "$SAFE")
t0=$(ms); res=$(approval_sign "$APR"); sign_ms=$(( $(ms) - t0 )); TX=$(echo "$res" | jget "d['txHash']")
chk B3.sign-sends-chain-transaction "B3 sign in the Core stub pop-up sends the chain transaction (as $BUDGET's key)" "$(echo "$res" | jget "d['status']")" submitted "tx $TX in ${sign_ms}ms"
t0=$(ms); wait_for 30 pe_posted "$PE"; posted_ms=$(( $(ms) - t0 ))
chk B3.payment-entry-submitted "B3 the Payment Entry is submitted" "$(pe_field "$PE" docstatus)" 1 "${posted_ms}ms after the sign call returned"
chk B3.chain-moved-the-money "B3 the chain moved the test USDC: supplier +125.5, Safe -125.5" "$(( $(usdc $SUPPLIER_ADDR) - B_TO )) $(( B_SAFE - $(usdc "$SAFE") ))" "125500000 125500000"
chk B3.entry-carries-transaction-hash "B3 the entry carries the transaction hash" "$(pe_field "$PE" reference_no | tr 'A-F' 'a-f')" "$(echo "$TX" | tr 'A-F' 'a-f')"
chk B3.ledger-posted "B3 the ledger is posted (Safe account credited 125.5)" "$(gl_of "$PE" | jget "sum(g['credit'] for g in d['data'] if g['account']=='$SAFE_ACCOUNT')")" 125.5
chk B3.invoice-nothing-outstanding "B3 the invoice has nothing outstanding" "$(pi_outstanding "$PI")" 0.0
GLSAFE="{\"company\":\"$COMPANY\",\"from_date\":\"2000-01-01\",\"to_date\":\"2099-12-31\",\"account\":[\"$SAFE_ACCOUNT\"]}"; gl_safe_units() { core report run $SLUG "General Ledger" --as $ADMIN --filters "$GLSAFE" ${WORLD:+--world $WORLD} --json | jget "round(sum((r.get('debit') or 0)-(r.get('credit') or 0) for r in d['data']['rows'] if r.get('voucher_no'))*10**6)"; }; books_agree() { [ "$(gl_safe_units)" = "$(usdc "$SAFE")" ]; }
wait_for 30 books_agree; chk TL.books-agree-with-chain "TL row 7 (before B4 moves money with no document) the Safe account's General Ledger, the founder's capital in and payments out, equals the Safe's USDC on chain" "$(gl_safe_units)" "$(usdc "$SAFE")" "$SAFE_ACCOUNT"
PE_B3=$PE
}
