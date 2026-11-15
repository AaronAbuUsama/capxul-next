// What other packages may import of the lint package: the facts it owns that `pnpm generate` writes into the
// docs. The packages and their reasons (the root README's map), the gate's rungs (AGENTS.md's table), what each of
// our lint rules finds (the list in AGENTS.md), the packages with no map yet, and the
// typed-once rules' unmigrated lists, which `pnpm ratchets` (packages/generate, src/ratchets.entry.ts) counts as
// ratchets R1 to R3.

import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import plugin from "./plugin.ts";

export { GATE, type Rung } from "./gate.ts";
export { MAP, UNMAPPED } from "./maps.ts";
export { PACKAGES } from "./shape.ts";

/** Our lint rules, each by its name in `.oxlintrc.json` with what it finds, read from the plugin, in its order. */
export const RULES: ReadonlyArray<readonly [name: string, description: string]> = Arr.map(
  Rec.toEntries(plugin.rules ?? {}),
  ([name, rule]) => [`capxul/${name}`, rule.meta?.docs?.description ?? ""] as const,
);
export { unmigrated } from "./unmigrated.ts";
