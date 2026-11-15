// capxul/owned-values: a raw schema (Schema.String, Schema.Literals, Schema.Int, ...) appears only where a value is
// named, the blueprint's values files and machines, and there only as the whole of a named value, never as a field.
// Every field of an operation, event or refusal is a named value, so two fields that mean the same thing cannot
// disagree (docs/roadmap.md, "Typed once, by check"). Outside the blueprint, raw schemas appear only in entry files
// and in the edges listed under settings.capxul.schemaEdges, each with its reason, and in generated files.
import type { Context, ESTree } from "@oxlint/plugins";
import * as Arr from "effect/Array";
import { memberName } from "./names.ts";
import { isGenerated, ratcheted, type Unmigrated } from "./ratchet.ts";
import { isListed, matches, pathOf } from "./where.ts";

/** The schemas that describe a value of their own, rather than combine other schemas. */
const RAW = new Set([
  "String",
  "NonEmptyString",
  "Trimmed",
  "Char",
  "Number",
  "Finite",
  "Int",
  "BigInt",
  "Boolean",
  "Literal",
  "Literals",
  "TemplateLiteral",
  "Date",
  "DateTimeUtc",
  "Uint8Array",
  "URL",
  "Unknown",
  "Any",
  "Null",
  "Undefined",
  "Void",
  "Object",
  "Json",
]);

/** Where values are named: the blueprint's values files (each thing's and the common ones), its ids, and its lifecycles. */
const NAMING = [
  "packages/blueprint/src/things/**/values.ts",
  "packages/blueprint/src/common/values.ts",
  "packages/blueprint/src/common/ids.ts",
  "packages/blueprint/src/things/**/lifecycle.ts",
];

const message = (raw: string, naming: boolean): string =>
  naming
    ? `Schema.${raw} as a field: name the field's value in this file and use the name`
    : `Schema.${raw} outside the blueprint's values files and machines: use a value named in the blueprint, or list this file in settings.capxul.schemaEdges with a reason`;

/** The innermost object property that holds `node`, or null when it is not inside one. */
const holdingProperty = (node: ESTree.Node): ESTree.Node | null => {
  const parent: ESTree.Node | null | undefined = node.parent;
  if (parent === null || parent === undefined) return null;
  return parent.type === "Property" ? parent : holdingProperty(parent);
};

export const ownedValues = (listed: Unmigrated) =>
  ratcheted(
    "owned-values",
    "Raw schemas only as named values in the blueprint's values files and machines",
    listed,
    (context: Context, found) => {
      if (isListed(context, "entries") || isListed(context, "schemaEdges") || isGenerated(context)) return null;
      const path = pathOf(context);
      const naming = Arr.some(NAMING, (pattern) => matches(pattern, path));
      const reported = new Set<ESTree.Node>();
      return {
        MemberExpression: (node: ESTree.MemberExpression) => {
          const name = memberName(node);
          if (name === null || name[0] !== "Schema" || !RAW.has(name[1])) return;
          const property = holdingProperty(node);
          if (property === null && naming) return;
          const unit = property ?? node;
          if (reported.has(unit)) return;
          reported.add(unit);
          found({ node: unit, message: message(name[1], naming) });
        },
      };
    },
  );
