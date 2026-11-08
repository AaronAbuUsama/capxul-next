// Links from requests to the records of the two concepts it depends on that have not landed yet:
// documents' door and indexing's chain views. Each is taken from the sibling's own file by its
// conventional export name as soon as that module exists and exports it; until then it is a bare
// reference by the conventional id, which the build reports as `dangling`. `PENDING` is the whole
// set. Every other link of this concept is a plain static import. When documents and indexing land,
// these become static imports (the same pattern as books/target/organizations/links.ts).
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

const documentsProcedures = await load("../documents/procedures.ts");
const indexingData = await load("../indexing/data.ts");

// ── documents: the door ─────────────────────────────────────────────────────────────────────

/** Stores a request's document (its envelope or Memo) with its participants, in the request's transaction. */
export const procedure_documents_store = pick(documentsProcedures, "procedure_documents_store", "procedure", "documents.store");

// ── indexing: Ponder's views, scoped by Safe ────────────────────────────────────────────────

/** Who wears which hat now: the Organization's Invoicing hat, and a budget's office hat. */
export const table_hat_wearers = pick(indexingData, "table_hat_wearers", "table", "hat-wearers");
/** The v4 budget tree by company Safe: the budget an Organization pays a request from, by its chain id. */
export const table_chain_budgets = pick(indexingData, "table_chain_budgets", "table", "chain-budgets");

/** The pending links: concept, export name and conventional id. */
export const PENDING = [
  ["documents", "procedure_documents_store", "documents.store"],
  ["indexing", "table_hat_wearers", "hat-wearers"],
  ["indexing", "table_chain_budgets", "chain-budgets"],
] as const;
