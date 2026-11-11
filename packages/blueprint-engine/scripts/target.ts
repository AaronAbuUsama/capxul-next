// Shared by the tools that read the blueprint: build it, or say why it cannot be built. No tool but the entry
// points touches the process; this file only loads.

import { buildBlueprint, type Blueprint } from "../src/index.ts";

export type Loaded = { readonly ok: true; readonly blueprint: Blueprint } | { readonly ok: false; readonly error: string };

export const loadTarget = async (): Promise<Loaded> => {
  try {
    const mod = (await import("../../../blueprint/index.ts")) as { name?: string; records: unknown[] };
    return { ok: true, blueprint: buildBlueprint({ name: mod.name ?? "target", stage: "target", records: mod.records }) };
  } catch (cause) {
    return { ok: false, error: `the blueprint could not be built: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
};
