// The DocTypes the site's Capxul app defines (packages/frappe-app/capxul/capxul/doctype), and the Frappe and ERPNext
// DocTypes it links to or adds Custom Fields to (packages/frappe-app/capxul/setup.py, CUSTOM_FIELDS). Each record is the
// code exactly: `pnpm frappe:check-blueprint` compares them and fails the merge on any difference. For a Frappe or ERPNext
// DocType, `fields` lists only the Custom Fields Capxul adds; the rest is theirs.

import { defineDoctype, type Doctype } from "../../packages/blueprint-engine/src/index.ts";
import { concept_plugs, concept_sites } from "../shared/foundation.ts";
import { decision_plugs_hat_map_ships } from "./decisions.ts";

const ADMIN = [{ role: "System Manager", read: true, write: true, create: true, delete: true }];
const theirs = (id: string, name: string, app: "frappe" | "erpnext", about: string, fields: Doctype["fields"] = []) =>
  defineDoctype({ id, title: name, about, concept: concept_sites, name, app, fields });
const wallet = [{ name: "capxul_wallet_address", type: "Data" }] as const;

// ── Frappe's and ERPNext's ──────────────────────────────────────────────────────────────────

export const doctype_user = theirs("user", "User", "frappe", "A person's Frappe user; a hat's grant makes it (plugs.user-from-hat).");
export const doctype_role = theirs("role", "Role", "frappe", "A Frappe role; a hat gives a fixed list of them.");
export const doctype_account = theirs("account", "Account", "erpnext", "A node of the chart of accounts; the Safe's account is one.");
export const doctype_bank_account = theirs("bank-account", "Bank Account", "erpnext", "The Safe, as ERPNext's bank account.");
export const doctype_supplier = theirs("supplier", "Supplier", "erpnext", "A party Capxul pays, with its wallet address.", wallet);
export const doctype_customer = theirs("customer", "Customer", "erpnext", "A party that pays the Organization, with its wallet address.", wallet);
export const doctype_employee = theirs("employee", "Employee", "erpnext", "A staff record; the member hat makes one, with the person's wallet address.", wallet);
export const doctype_gl_entry = theirs("gl-entry", "GL Entry", "erpnext", "A ledger line; Capxul stamps the trace that posted it.", [
  { name: "capxul_trace", type: "Data", readOnly: true },
]);
export const doctype_payment_entry = theirs("payment-entry", "Payment Entry", "erpnext", "A payment from the Safe, held until the chain confirms it.", [
  { name: "capxul_status", type: "Data", readOnly: true },
  { name: "capxul_approval_url", type: "Data", readOnly: true },
]);

// ── Capxul's own ────────────────────────────────────────────────────────────────────────────

export const doctype_capxul_settings = defineDoctype({
  id: "capxul-settings",
  title: "Capxul Settings",
  about: "The site's one settings document: its Organization, its Safe and asset, where Core is, the secret Core signs with, and the last chain event applied.",
  concept: concept_plugs,
  name: "Capxul Settings",
  app: "capxul",
  single: true,
  fields: [
    { name: "org_slug", type: "Data", required: true },
    { name: "safe_address", type: "Data" },
    { name: "asset", type: "Data", default: "USDC" },
    { name: "core_url", type: "Data", default: "http://host.docker.internal:8787" },
    { name: "secret", type: "Password" },
    { name: "safe_account", type: "Link", link: doctype_account },
    { name: "safe_bank_account", type: "Link", link: doctype_bank_account },
    { name: "last_seq", type: "Int", readOnly: true, default: "0" },
  ],
  permissions: ADMIN,
});

export const doctype_capxul_chain_event = defineDoctype({
  id: "capxul-chain-event",
  title: "Capxul Chain Event",
  about: "One chain event Core sent the site, applied once by its key: applied, failed (retried) or parked.",
  concept: concept_plugs,
  name: "Capxul Chain Event",
  app: "capxul",
  naming: "field:event_key",
  fields: [
    { name: "event_key", type: "Data", required: true, unique: true },
    { name: "seq", type: "Int", required: true },
    { name: "org", type: "Data" },
    { name: "kind", type: "Data" },
    { name: "status", type: "Select", options: ["Applied", "Failed", "Parked"], default: "Applied" },
    { name: "attempts", type: "Int", default: "0" },
    { name: "error", type: "Small Text" },
    { name: "data", type: "Code", options: ["JSON"] },
  ],
  permissions: ADMIN,
});

export const doctype_capxul_feature = defineDoctype({
  id: "capxul-feature",
  title: "Capxul Feature",
  about: "One feature switch on the site, written only by Core's switch (sites.features-reachability); read-only on the site.",
  concept: concept_sites,
  name: "Capxul Feature",
  app: "capxul",
  naming: "field:feature",
  fields: [
    { name: "feature", type: "Data", required: true, unique: true, readOnly: true },
    { name: "enabled", type: "Check", readOnly: true },
    { name: "note", type: "Data", readOnly: true },
  ],
  permissions: [{ role: "System Manager", read: true, write: false, create: false, delete: false }],
});

export const doctype_capxul_hat_role = defineDoctype({
  id: "capxul-hat-role",
  title: "Capxul Hat Role",
  about: "One Frappe role in a hat's row of the editable hat map.",
  concept: concept_plugs,
  name: "Capxul Hat Role",
  app: "capxul",
  child: true,
  fields: [{ name: "role", type: "Link", link: doctype_role, required: true }],
  permissions: [],
  retiredBy: decision_plugs_hat_map_ships,
});

export const doctype_capxul_hat_map = defineDoctype({
  id: "capxul-hat-map",
  title: "Capxul Hat Map",
  about: "The spike's hat-to-role map: one document per hat, editable on the site. The blueprint ships the map inside the app instead (plugs.hat-map-ships), so this goes.",
  concept: concept_plugs,
  name: "Capxul Hat Map",
  app: "capxul",
  naming: "field:hat",
  fields: [
    { name: "hat", type: "Data", required: true, unique: true },
    { name: "roles", type: "Table", link: doctype_capxul_hat_role },
  ],
  permissions: ADMIN,
  retiredBy: decision_plugs_hat_map_ships,
});

export const doctype_capxul_hat_grant = defineDoctype({
  id: "capxul-hat-grant",
  title: "Capxul Hat Grant",
  about: "One hat applied to one user in one department, with the roles it added, so a revoke removes only those no other grant gives.",
  concept: concept_plugs,
  name: "Capxul Hat Grant",
  app: "capxul",
  naming: "hash",
  fields: [
    { name: "user", type: "Link", link: doctype_user, required: true },
    { name: "hat", type: "Data", required: true },
    { name: "department", type: "Data" },
    { name: "roles_given", type: "Small Text", about: "JSON list: the roles this grant added." },
    { name: "event_key", type: "Data" },
  ],
  permissions: ADMIN,
});

export const doctype_capxul_payment_request = defineDoctype({
  id: "capxul-payment-request",
  title: "Capxul Payment Request",
  about: "A Payment Entry from the Safe, held while the chain is asked to pay it: the document's hash, the approval, the transaction, and why it failed.",
  concept: concept_plugs,
  name: "Capxul Payment Request",
  app: "capxul",
  naming: "format:CPR-{#####}",
  fields: [
    { name: "payment_entry", type: "Link", link: doctype_payment_entry, required: true },
    { name: "document_hash", type: "Data", required: true },
    { name: "status", type: "Select", options: ["Requesting", "Waiting for signature", "Sent", "Failed", "Mismatch"] },
    { name: "requested_by", type: "Link", link: doctype_user },
    { name: "approval_id", type: "Data" },
    { name: "approval_url", type: "Data" },
    { name: "tx_hash", type: "Data" },
    { name: "reason", type: "Small Text" },
    { name: "canonical_json", type: "Code", options: ["JSON"] },
  ],
  permissions: ADMIN,
});
