// The one link from accounts to a record of a concept that is not designed yet: indexing's escrows
// view, which the setup process reads to find the claim escrows waiting for a person's Safe.
//
// It is taken from indexing's data.ts by its conventional export name as soon as that module
// exists and exports it. Until then it is a bare reference by the conventional id (`escrows`),
// which the build reports as `dangling`. Once indexing lands, this file becomes a static import in
// ./processes.ts and is deleted. Every other link to access, parties and approvals is a plain
// static import from that concept's own file.
//
// This module is not in ./index.ts's `modules`: it holds a link, never a record of its own.

import type { Ref } from "../../../packages/book/src/index.ts";

const load = async (path: string): Promise<Record<string, unknown>> => {
  try {
    return (await import(path)) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const indexingData = await load("../indexing/data.ts");
const found = indexingData.table_escrows as { _kind?: unknown } | undefined;

/** Ponder's escrows, scoped by Safe: each escrow's terms (payee Safe, condition, token, amount) and its state. */
export const table_escrows: Ref<"table"> = found && found._kind === "table" ? (found as Ref<"table">) : { _kind: "table", id: "escrows" };
