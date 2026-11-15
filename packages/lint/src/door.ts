// The lint package's door: the facts it owns that `pnpm generate` writes into the docs. The packages and their
// reasons (the root README's map), the ladder (AGENTS.md's table), what each of our lint rules finds (the lists in
// AGENTS.md and this package's README), and the packages with no map yet.
import { description as blueprintOwnsNames } from "./rules/blueprint-owns-names.ts";
import { description as declaredNames } from "./rules/declared-names.ts";
import { description as decodedRows } from "./rules/decoded-rows.ts";
import { description as effectOnly } from "./rules/effect-only.ts";
import { description as importDoor } from "./rules/import-door.ts";
import { description as noJsonText } from "./rules/no-json-text.ts";
import { description as ownedValues } from "./rules/owned-values.ts";

export { LADDER, type Rung } from "./ladder.ts";
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
