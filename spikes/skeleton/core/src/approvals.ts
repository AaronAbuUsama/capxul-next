// Payment approvals: /prepare creates one, the approve page shows it, /sign sends the transaction as the
// requesting person. STAND-IN for the Capxul signing pop-up (the real one is an OpenFort iframe + passkey).
import { randomBytes } from "node:crypto";
import { isAddress, type Address, type Hex } from "viem";
import { sendPayment, toUnits } from "./chain.ts";
import { config } from "./config.ts";
import { esc, html, page } from "./http.ts";
import { enqueue, getOrg } from "./outbox.ts";
import { byEmail } from "./people.ts";
import { loadJson, saveJson } from "./store.ts";
import { poll } from "./watcher.ts";

export type Approval = {
  id: string; org: string; site: string; doctype: string; name: string; document_hash: string;
  requested_by: string; to_party: string; to_address: string; amount: string; asset: string; department?: string;
  status: "pending" | "signing" | "submitted" | "failed"; txHash?: string; reason?: string; detail?: string; createdAt: string;
};
const store = loadJson<Record<string, Approval>>("approvals.json", {});
const save = () => saveJson("approvals.json", store);
const log = (m: string) => console.log(`${new Date().toISOString()} [approval] ${m}`);

export const getApproval = (id: string) => store[id];

// Returns an error string, or the approval.
export function prepare(b: Record<string, any>): string | Approval {
  for (const k of ["org", "site", "doctype", "name", "document_hash", "requested_by", "to_party", "to_address", "amount"]) {
    if (typeof b[k] !== "string" || !b[k]) return `missing field: ${k}`;
  }
  if (!getOrg(b.org)) return `unknown org: ${b.org}`;
  if (b.site !== `${b.org}.localhost`) return `site ${b.site} does not belong to org ${b.org}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(b.document_hash)) return "document_hash must be 0x + 64 hex";
  if (!isAddress(b.to_address)) return "to_address is not an address";
  if (!/^\d+(\.\d{1,6})?$/.test(b.amount) || toUnits(b.amount) <= 0n) return "amount must be a positive decimal with at most 6 places";
  if (!byEmail(b.requested_by)) return `requested_by ${b.requested_by} is not a person Capxul knows (a Frappe user is a person only if a hat created it; Administrator never is)`;
  // the same document asked twice while still waiting returns the same approval
  const again = Object.values(store).find((a) => a.status === "pending" && a.org === b.org && a.doctype === b.doctype
    && a.name === b.name && a.document_hash === b.document_hash && a.requested_by === b.requested_by);
  if (again) return again;
  const a: Approval = { id: `apr_${randomBytes(8).toString("hex")}`, org: b.org, site: b.site, doctype: b.doctype, name: b.name,
    document_hash: b.document_hash, requested_by: b.requested_by, to_party: b.to_party, to_address: b.to_address,
    amount: b.amount, asset: b.asset ?? "USDC", department: b.department, status: "pending", createdAt: new Date().toISOString() };
  store[a.id] = a; save();
  log(`${a.id} prepared: ${a.org} pays ${a.amount} to ${a.to_party} for ${a.doctype} ${a.name}`);
  return a;
}

export const approvalUrl = (a: Approval) => `${config.coreBrowserUrl}/approve/${a.id}`;

export function approvePage(a: Approval): string {
  const org = getOrg(a.org);
  const result = a.status === "submitted" ? `<p class="ok">Signed and sent. Transaction <code>${esc(a.txHash)}</code>. The books post when the chain confirms.</p>`
    : a.status === "failed" ? `<p class="bad">Not sent: <b>${esc(a.reason)}</b> (${esc(a.detail)}). Nothing moved.</p>`
    : a.status === "signing" ? `<p>Signing...</p>`
    : `<form method="post" action="/approve/${esc(a.id)}/sign"><button>Sign</button></form>`;
  return page("Approve payment (stand-in)", `<h1>Approve a payment</h1>
<p class="standin">Stand-in for the Capxul signing pop-up (the real one is an OpenFort iframe with a passkey).</p>
<dl><dt>Who pays</dt><dd>${esc(org?.name ?? a.org)}<br><small>Safe ${esc(org?.safe)}</small></dd>
<dt>Pays</dt><dd>${esc(a.to_party)}<br><small>${esc(a.to_address)}</small></dd>
<dt>Amount</dt><dd><b>${esc(a.amount)} ${esc(a.asset)}</b></dd>
<dt>For document</dt><dd>${esc(a.doctype)} ${esc(a.name)}<br><small>${esc(a.document_hash)}</small></dd>
<dt>Signing as</dt><dd>${esc(a.requested_by)}</dd></dl>${result}`);
}

// Sign: simulate, then send as the requesting person's test key. The outcome reaches Frappe only as a chain_event.
export async function sign(id: string): Promise<Approval | undefined> {
  const a = store[id];
  if (!a || a.status !== "pending") return a; // a second press changes nothing
  a.status = "signing"; save();
  const person = byEmail(a.requested_by)!;
  const r = await sendPayment({ org: a.org, to: a.to_address as Address, amount: toUnits(a.amount),
    documentHash: a.document_hash as Hex, privateKey: person.privateKey });
  if (r.ok) {
    a.status = "submitted"; a.txHash = r.txHash; save();
    log(`${a.id} sent as ${person.email}: ${r.txHash}`);
    await poll().catch((e) => log(`ERROR watcher after sign: ${e.message}`)); // the interval would catch it anyway
  } else {
    a.status = "failed"; a.reason = r.reason; a.detail = r.detail; save();
    log(`${a.id} refused: ${r.reason} (${r.detail})`);
    enqueue(a.org, `approval:${a.id}:failed`, "payment_failed",
      { approval_id: a.id, document_hash: a.document_hash, reason: r.reason, detail: r.detail });
  }
  return a;
}
