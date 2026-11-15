// What other packages may import of the lint package: the facts it owns that `pnpm generate` writes into the docs. The packages and their
// reasons (the root README's map), the gate's rungs (AGENTS.md's table), what each of our lint rules finds (the lists in
// AGENTS.md and this package's README), the packages with no map yet, and the typed-once rules' unmigrated lists, which `pnpm ratchets`
// (packages/blueprint-tools, src/checks/) counts as ratchets R1 to R3.
import { description as blueprintOwnsNames } from "./rules/blueprint-owns-names.ts";
import { description as declaredNames } from "./rules/declared-names.ts";
import { description as decodedRows } from "./rules/decoded-rows.ts";
import { description as effectOnly } from "./rules/effect-only.ts";
import { description as importDoor } from "./rules/import-door.ts";
import { description as noJsonText } from "./rules/no-json-text.ts";
import { description as ownedValues } from "./rules/owned-values.ts";

export { GATE, type Rung } from "./gate.ts";
export { MAP, UNMAPPED } from "./maps.ts";
export { PACKAGES } from "./shape.ts";

/** Our lint rules, each by its name in `.oxlintrc.json` with what it finds, in the order AGENTS.md lists them. */
export const RULES: ReadonlyArray<readonly [name: string, description: string]> = [
  ["capxul/blueprint-owns-names", blueprintOwnsNames],
  ["capxul/effect-only", effectOnly],
  ["capxul/import-door", importDoor],
  ["capxul/no-json-text", noJsonText],
  ["capxul/owned-values", ownedValues],
  ["capxul/declared-names", declaredNames],
  ["capxul/decoded-rows", decodedRows],
];
export { unmigrated } from "./unmigrated.ts";
