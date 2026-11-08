// Links from activity to the records of documents, which activity depends on and which is being
// designed at the same time: the pattern of books/target/payments/links.ts. Each link is the
// sibling's own record, by its conventional export name, as soon as that module loads and exports
// it; until then it is a bare reference by the conventional id, which the build reports as
// `dangling`. `PENDING` is the whole set. When documents lands, these become static imports.
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

const documentsData = await load("../documents/data.ts");

/** The stored documents and their participants: the documents a Payment or a Movement carries, and who may read each. */
export const table_documents = pick(documentsData, "table_documents", "table", "documents");

/** The pending links: concept, export name and conventional id. */
export const PENDING = [["documents", "table_documents", "documents"]] as const;
