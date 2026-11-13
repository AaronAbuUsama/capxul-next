// The capxul oxlint plugin: the repository's own lint rules. .oxlintrc.json loads it and turns each rule on.
import type { Plugin } from "@oxlint/plugins";
import { blueprintOwnsNames } from "./rules/blueprint-owns-names.ts";
import { effectOnly } from "./rules/effect-only.ts";
import { importDoor } from "./rules/import-door.ts";
import { noJsonText } from "./rules/no-json-text.ts";

const plugin: Plugin = {
  meta: { name: "capxul" },
  rules: {
    "blueprint-owns-names": blueprintOwnsNames,
    "effect-only": effectOnly,
    "import-door": importDoor,
    "no-json-text": noJsonText,
  },
};

export default plugin;
