// Shared by the tools that read the target book: build it, or say why it cannot be built. No tool but the entry
// points touches the process; this file only loads.

import { buildBook, type Book } from "../src/index.ts";

export type Loaded = { readonly ok: true; readonly book: Book } | { readonly ok: false; readonly error: string };

export const loadTarget = async (): Promise<Loaded> => {
  try {
    const mod = (await import("../../../books/target/index.ts")) as { name?: string; records: unknown[] };
    return { ok: true, book: buildBook({ name: mod.name ?? "target", stage: "target", records: mod.records }) };
  } catch (cause) {
    return { ok: false, error: `the target book could not be built: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
};
