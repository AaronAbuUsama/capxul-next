// Links from equity to the doors of two concepts it depends on that are being designed at the same
// time (board and documents), the pattern books/target/payroll/links.ts set. Each link is the sibling's
// own record, by its conventional export name, as soon as that module loads; until then it is a bare
// reference by the procedure's id, which the build reports as `dangling`. Both ids are named by the
// architecture (rules.procedures), so only the record behind them is pending. When both siblings land,
// these become plain imports.
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

const pick = <K extends Kind>(from: Record<string, unknown>, exportName: string, kind: K, id: string): Ref<K> => {
  const found = from[exportName] as { _kind?: unknown } | undefined;
  return found && found._kind === kind ? (found as Ref<K>) : { _kind: kind, id };
};

const boardDoor = await load("../board/procedures.ts");
const documentsDoor = await load("../documents/procedures.ts");

/** Money fact: a Board proposal and the intent it carries are one fact; every Board matter of equity. */
export const procedure_board_propose = pick(boardDoor, "procedure_board_propose", "procedure", "board.propose");
/** Money fact: a hash on chain with no content behind it is a money bug; every terms, agreement and reason document. */
export const procedure_documents_store = pick(documentsDoor, "procedure_documents_store", "procedure", "documents.store");

/** The pending links: concept, export name and id. */
export const PENDING = [
  ["board", "procedure_board_propose", "board.propose"],
  ["documents", "procedure_documents_store", "documents.store"],
] as const;
