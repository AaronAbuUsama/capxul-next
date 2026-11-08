// Links from applications to the records of the one concept it depends on that has not landed in
// books/target/index.ts yet: indexing's chain views. Each is taken from indexing's own data.ts by its
// conventional export name as soon as that module loads and exports it; until then it is a bare
// reference by the conventional id, which the build reports as `dangling`. `PENDING` is the whole
// set. Every other link of this concept is a plain static import. When indexing lands, this becomes a
// static import (the same pattern as books/target/organizations/links.ts).
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

// ── indexing: Ponder's views, scoped by Safe ────────────────────────────────────────────────

/** Who wears which hat now: an Organization's keys are managed by the wearers of its Invoicing hat. */
export const table_hat_wearers = pick(indexingData, "table_hat_wearers", "table", "hat-wearers");

/** The pending links: concept, export name and conventional id. */
export const PENDING = [["indexing", "table_hat_wearers", "hat-wearers"]] as const;
