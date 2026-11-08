// Links from organizations to the records of the two concepts it depends on that have not landed
// yet: indexing's chain views and media's files. Each is taken from the sibling's own data.ts by
// its conventional export name as soon as that module exists and exports it; until then it is a
// bare reference by the conventional id, which the build reports as `dangling`. `PENDING` is the
// whole set. Every other link of this concept is a plain static import. When indexing and media
// land, these become static imports.
//
// This module is not in ./index.ts's `modules`: it re-exports links, never records of its own.

import type { Kind, Ref } from "../../../packages/book/src/index.ts";

const load = async (path: string): Promise<Record<string, unknown>> => {
  try {
    return (await import(path)) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const pick = <K extends Kind>(from: Record<string, unknown>, exportName: string, kind: K, id: string): Ref<K> => {
  const found = from[exportName] as { _kind?: unknown } | undefined;
  return found && found._kind === kind ? (found as Ref<K>) : { _kind: kind, id };
};

const indexingData = await load("../indexing/data.ts");
const mediaData = await load("../media/data.ts");

// ── indexing: Ponder's views, scoped by Safe ────────────────────────────────────────────────

/** Who wears which hat now (Hats TransferSingle and standing): officer hats, the Director hat, budgets' office hats. */
export const table_hat_wearers = pick(indexingData, "table_hat_wearers", "table", "hat-wearers");
/** A Safe's owners, threshold, nonce, modules and guard: the company Safe's Board and the Gate's valid signers. */
export const table_safe_owners = pick(indexingData, "table_safe_owners", "table", "safe-owners");
/** ApproveHash: a Director's approval of a company Safe transaction, for the proposals that wait. */
export const table_safe_approvals = pick(indexingData, "table_safe_approvals", "table", "safe-approvals");
/** ExecutionSuccess and ExecutionFailure of a company Safe transaction, by its hash and nonce. */
export const table_safe_executions = pick(indexingData, "table_safe_executions", "table", "safe-executions");
/** The v4 budget tree by company Safe: each budget's token, amount, office hat, parent and per-payment cap. */
export const table_chain_budgets = pick(indexingData, "table_chain_budgets", "table", "chain-budgets");

// ── media ───────────────────────────────────────────────────────────────────────────────────

/** Stored files, with their type and size: an Organization's logo must be admitted as an image. */
export const table_files = pick(mediaData, "table_files", "table", "files");

/** The pending links: concept, export name and conventional id. */
export const PENDING = [
  ["indexing", "table_hat_wearers", "hat-wearers"],
  ["indexing", "table_safe_owners", "safe-owners"],
  ["indexing", "table_safe_approvals", "safe-approvals"],
  ["indexing", "table_safe_executions", "safe-executions"],
  ["indexing", "table_chain_budgets", "chain-budgets"],
  ["media", "table_files", "files"],
] as const;
