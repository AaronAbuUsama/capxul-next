// The capxul oxlint plugin: the repository's own lint rules. .oxlintrc.json loads it and turns each rule on.
// capxul/declared-names is fed the names the blueprint declares, read from the blueprint's door, so the blueprint
// stays their one owner; the ratcheted rules are fed their unmigrated lists (src/unmigrated.ts).
import type { Plugin } from "@oxlint/plugins";
import { declaredNames as blueprintNames } from "@capxul/blueprint";
import { blueprintOwnsNames } from "./rules/blueprint-owns-names.ts";
import { declaredNames } from "./rules/declared-names.ts";
import { declaredSteps } from "./rules/declared-steps.ts";
import { decodedRows } from "./rules/decoded-rows.ts";
import { effectOnly } from "./rules/effect-only.ts";
import { importDoor } from "./rules/import-door.ts";
import { noJsonText } from "./rules/no-json-text.ts";
import { ownedValues } from "./rules/owned-values.ts";
import { unmigrated } from "./unmigrated.ts";

const plugin: Plugin = {
  meta: { name: "capxul" },
  // In the order AGENTS.md lists them: `pnpm generate` writes that list from these rules' descriptions.
  rules: {
    "blueprint-owns-names": blueprintOwnsNames,
    "effect-only": effectOnly,
    "import-door": importDoor,
    "no-json-text": noJsonText,
    "owned-values": ownedValues(unmigrated["owned-values"]),
    "declared-names": declaredNames(blueprintNames, unmigrated["declared-names"]),
    "decoded-rows": decodedRows(unmigrated["decoded-rows"]),
    "declared-steps": declaredSteps(unmigrated["declared-steps"]),
  },
};

export default plugin;
