// Links from accounts to records of the concepts it depends on (access, parties, indexing and
// approvals), which are being designed at the same time as this one.
//
// Each link is taken from the sibling's own module by its conventional export name
// (CONVENTIONS.md, "Ids and export names") as soon as that module exists. Until then it is a bare
// reference by the conventional id, which the build reports as `dangling`; the list below is the
// whole set of such links, and nothing else in this concept refers to another concept's records.
// When every sibling has landed, these can become plain static imports.
//
// This module is not in ./index.ts's `modules`: it re-exports links, never records of its own.

import type { Kind, Ref } from "../../../packages/book/src/index.ts";

/** A sibling module's exports, or none while it does not exist or does not load yet. */
const load = async (path: string): Promise<Record<string, unknown>> => {
  try {
    return (await import(path)) as Record<string, unknown>;
  } catch {
    return {};
  }
};

/** Every export of a sibling concept, through its index's `modules`. */
const conceptExports = async (concept: string): Promise<Record<string, unknown>> => {
  const index = await load(`../${concept}/index.ts`);
  const modules = (Array.isArray(index.modules) ? index.modules : []) as Record<string, unknown>[];
  return Object.assign({}, ...modules);
};

const pick = <K extends Kind>(from: Record<string, unknown>, exportName: string, kind: K, id: string): Ref<K> => {
  const found = from[exportName] as { _kind?: unknown } | undefined;
  return found && found._kind === kind ? (found as Ref<K>) : { _kind: kind, id };
};

const accessData = await load("../access/data.ts");
const accessAll = await conceptExports("access");
const partiesData = await load("../parties/data.ts");
const partiesDoor = await load("../parties/procedures.ts");
const indexingData = await load("../indexing/data.ts");
const approvalsDoor = await load("../approvals/procedures.ts");

// ── access ──────────────────────────────────────────────────────────────────────────────────

/** The feature gates, synced from PostHog per person or Organization: `beta-access` says whether the beta is open to a person. */
export const table_feature_gates = pick(accessData, "table_feature_gates", "table", "feature-gates");
/** Sends a six-digit sign-in code to an email, with the send cooldown. */
export const rpc_access_sign_in_send_code = pick(accessAll, "rpc_access_sign_in_send_code", "rpc", "access.sign-in.send-code");
/** Checks the code and returns the person's session. */
export const rpc_access_sign_in_verify_code = pick(accessAll, "rpc_access_sign_in_verify_code", "rpc", "access.sign-in.verify-code");
/** A challenge for an agent's key to sign. */
export const rpc_access_sign_in_challenge = pick(accessAll, "rpc_access_sign_in_challenge", "rpc", "access.sign-in.challenge");
/** Signs in as the agent whose Safe the signed challenge's key solely owns. */
export const rpc_access_sign_in_with_key = pick(accessAll, "rpc_access_sign_in_with_key", "rpc", "access.sign-in.with-key");

// ── parties ─────────────────────────────────────────────────────────────────────────────────

/** The directory: each Party with its handle, its Safe and its owner. */
export const table_parties = pick(partiesData, "table_parties", "table", "parties");
/** Money fact: a name and the Safe it routes money to (the architecture names it). */
export const procedure_parties_register = pick(partiesDoor, "procedure_parties_register", "procedure", "parties.register");

// ── indexing ────────────────────────────────────────────────────────────────────────────────

/** Ponder's escrows, scoped by Safe: each escrow's terms (payee Safe, condition, token, amount) and its state. */
export const table_escrows = pick(indexingData, "table_escrows", "table", "escrows");

// ── approvals ───────────────────────────────────────────────────────────────────────────────

/** Money fact: an approval is born with the calls it carries (the architecture names it). */
export const procedure_approvals_open = pick(approvalsDoor, "procedure_approvals_open", "procedure", "approvals.open");

/** The pending links, for the build report and reviewers: export name and conventional id. */
export const PENDING = [
  ["access", "table_feature_gates", "feature-gates"],
  ["access", "rpc_access_sign_in_send_code", "access.sign-in.send-code"],
  ["access", "rpc_access_sign_in_verify_code", "access.sign-in.verify-code"],
  ["access", "rpc_access_sign_in_challenge", "access.sign-in.challenge"],
  ["access", "rpc_access_sign_in_with_key", "access.sign-in.with-key"],
  ["parties", "table_parties", "parties"],
  ["parties", "procedure_parties_register", "parties.register"],
  ["indexing", "table_escrows", "escrows"],
  ["approvals", "procedure_approvals_open", "approvals.open"],
] as const;
