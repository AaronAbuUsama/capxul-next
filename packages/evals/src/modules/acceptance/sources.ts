import assert from "node:assert/strict";
import { sessionCookie, type Fixture } from "./fixture.ts";

export type Doc = Record<string, any>;
export interface Sources {
  invoice: Doc;
  supplier: Doc;
  payment: Doc;
  request: Doc;
  ledger: Doc[];
  trial: Doc[];
  receipt: Doc | null;
  safeAtomic: string;
  block: string;
  observedAt: string;
}

/** Cent-exact fixture accounting; reject extra precision instead of rounding a disagreement away. */
export function cents(value: unknown): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2})0*)?$/.exec(String(value));
  assert(match, `not a cent-exact accounting value: ${String(value)}`);
  return (match[1] ? -1n : 1n) * (BigInt(match[2]!) * 100n + BigInt((match[3] ?? "").padEnd(2, "0")));
}

export async function frappe(f: Fixture, path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(path, f.frappeUrl);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "X-Frappe-Site-Name": f.site, Cookie: `sid=${sessionCookie(f.cookieJar)}` }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Frappe read ${url.pathname} returned HTTP ${res.status}`);
  return res.json();
}

async function rpc<T = string>(f: Fixture, method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(f.rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15000) });
  const value = await res.json() as { result?: T; error?: unknown };
  assert(res.ok && value.result !== undefined && !value.error, `chain ${method} did not return a value`);
  return value.result;
}

export async function readSources(f: Fixture): Promise<Sources> {
  const identity = await frappe(f, "/api/method/frappe.auth.get_logged_user");
  assert.equal(identity.message, f.user, "screen/API reads must use the fixture hat holder");
  const block = await rpc(f, "eth_blockNumber");
  const resource = (dt: string, name: string) => frappe(f, `/api/resource/${encodeURIComponent(dt)}/${encodeURIComponent(name)}`).then((r) => r.data);
  const list = (dt: string, filters: unknown, fields: string[]) => frappe(f, `/api/resource/${encodeURIComponent(dt)}`, {
    filters: JSON.stringify(filters), fields: JSON.stringify(fields), limit_page_length: "1000",
  }).then((r) => { assert(r.data.length < 1000, "source list is truncated"); return r.data; });
  const [invoice, supplier, payment, requests, ledger, report, safe, receipt] = await Promise.all([
    resource("Purchase Invoice", f.invoice), resource("Supplier", f.supplier), resource("Payment Entry", f.paymentEntry),
    list("Capxul Payment Request", [["payment_entry", "=", f.paymentEntry]], ["name", "status", "tx_hash", "approval_url"]),
    list("GL Entry", [["company", "=", f.company], ["is_cancelled", "=", 0]], ["name", "account", "debit", "credit", "voucher_no", "capxul_trace", "posting_date"]),
    frappe(f, "/api/method/frappe.desk.query_report.run", { report_name: "Trial Balance", filters: JSON.stringify({ company: f.company, fiscal_year: "2026", from_date: "2026-01-01", to_date: "2026-12-31" }), ignore_prepared_report: "1" }),
    rpc(f, "eth_call", [{ to: f.token, data: `0x70a08231${f.safe.slice(2).padStart(64, "0")}` }, block]),
    rpc<Doc | null>(f, "eth_getTransactionReceipt", [f.txHash]),
  ]);
  assert.equal(await rpc(f, "eth_blockNumber"), block, "chain moved across the accounting cutoff; retry with a quiet clock");
  assert.equal(requests.length, 1, "the selected payment must have exactly one request");
  return { invoice, supplier, payment, request: requests[0], ledger, trial: report.message.result, receipt, safeAtomic: BigInt(safe).toString(), block, observedAt: new Date().toISOString() };
}

export function reconcile(f: Fixture, s: Sources): void {
  const amount = BigInt(f.amountAtomic) / 10000n;
  const receipt = s.receipt;
  assert(receipt && receipt.status === "0x1", "selected payment has no successful chain receipt");
  assert.equal(String(receipt.transactionHash).toLowerCase(), f.txHash.toLowerCase(), "receipt is for a different transaction");
  assert(/^0x[0-9a-f]+$/i.test(receipt.blockNumber) && BigInt(receipt.blockNumber) <= BigInt(s.block), "selected payment receipt is not mined at/before the cutoff");
  assert.equal(s.supplier.name, f.supplier);
  assert(/^0x[0-9a-f]{40}$/i.test(s.supplier.capxul_wallet_address), "supplier has no chain wallet");
  const topic = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
  assert(Array.isArray(receipt.logs), "selected payment receipt has no logs");
  const transfers = receipt.logs.filter((log: Doc) => String(log.address).toLowerCase() === f.token.toLowerCase()
    && log.topics?.[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
    && String(log.topics[1]).toLowerCase() === topic(f.safe));
  assert.equal(transfers.length, 1, "selected receipt must transfer the token from the Safe exactly once");
  const transfer = transfers[0];
  assert.equal(transfer.removed, false, "selected transfer was removed");
  assert.equal(String(transfer.transactionHash).toLowerCase(), f.txHash.toLowerCase());
  assert.equal(transfer.topics.length, 3);
  assert.equal(String(transfer.topics[2]).toLowerCase(), topic(s.supplier.capxul_wallet_address), "selected transfer paid a different supplier wallet");
  assert.equal(BigInt(transfer.data), BigInt(f.amountAtomic), "selected transfer paid a different amount");
  const pi = s.invoice, pe = s.payment;
  assert.equal(pi.name, f.invoice); assert.equal(pe.name, f.paymentEntry);
  for (const doc of [pi, pe]) { assert.equal(doc.company, f.company); assert.equal(doc.docstatus, 1); }
  assert.equal(pi.supplier, f.supplier); assert.equal(pi.currency, "USD");
  assert.equal(cents(pi.grand_total), amount); assert.equal(cents(pi.outstanding_amount), 0n);
  assert.equal(pe.party, f.supplier); assert.equal(pe.paid_from, f.safeAccount); assert.equal(pe.paid_from_account_currency, "USD");
  assert.equal(cents(pe.paid_amount), amount); assert.equal(pe.capxul_status, "Sent");
  assert.equal(String(pe.reference_no).toLowerCase(), f.txHash.toLowerCase());
  assert(pe.capxul_approval_url, "payment lost its approval link");
  assert.equal(s.request.status, "Sent"); assert.equal(String(s.request.tx_hash).toLowerCase(), f.txHash.toLowerCase());
  assert.equal(s.request.approval_url, pe.capxul_approval_url);
  const references = pe.references.filter((r: Doc) => r.reference_doctype === "Purchase Invoice" && r.reference_name === f.invoice);
  assert.equal(references.length, 1); assert.equal(cents(references[0].allocated_amount), amount);
  const posted = s.ledger.filter((r) => r.voucher_no === f.paymentEntry);
  assert(posted.length >= 2, "payment has no double-entry ledger posting");
  assert(posted.every((r) => typeof r.capxul_trace === "string" && r.capxul_trace.length > 0), "payment ledger lost its trace");
  assert.equal(new Set(posted.map((r) => r.capxul_trace)).size, 1, "payment ledger has conflicting traces");
  const total = (rows: Doc[], key: string) => rows.reduce((a, r) => a + cents(r[key] ?? 0), 0n);
  assert.equal(total(posted, "debit"), total(posted, "credit"), "payment posting is unbalanced");
  const cash = posted.filter((r) => r.account === f.safeAccount);
  assert.equal(cash.length, 1, "payment must have exactly one Safe posting");
  assert.equal(total(cash, "debit"), 0n); assert.equal(total(cash, "credit"), amount, "Safe was not credited exactly once");
  const safeRows = s.ledger.filter((r) => r.account === f.safeAccount);
  const net = total(safeRows, "debit") - total(safeRows, "credit");
  assert.equal(net * 10000n, BigInt(s.safeAtomic), "Safe book balance differs from same-cutoff USDC");
  const trial = s.trial.filter((r) => r.account === f.safeAccount);
  assert.equal(trial.length, 1, "Trial Balance must contain one Safe account");
  assert.equal(cents(trial[0]!.closing_debit) - cents(trial[0]!.closing_credit), net);
}
