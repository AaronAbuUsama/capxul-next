// capxul/declared-names: a name the blueprint declares (an operation, a refusal's tag, an event's or an outcome's
// tag, a starting world) is imported, never written again as a string, so a rename cannot leave a copy behind
// (docs/roadmap.md, "Typed once, by check"). The blueprint itself and generated files are exempt. A string the
// compiler checks against the declarations is allowed: an object's key, a computed member (`client["world.create"]`),
// and the tag given to Effect.catchTag, Match.tag, Match.tagStartsWith or Predicate.isTagged.
import type { Context, ESTree } from "@oxlint/plugins";
import * as Arr from "effect/Array";
import { isGenerated, ratcheted, type Unmigrated } from "./ratchet.ts";
import { matches, pathOf } from "./where.ts";

/** What the rule finds, as AGENTS.md and packages/lint/README.md list it (written there by `pnpm generate`). */
export const description =
  "a name the blueprint declares (an operation, a refusal, an event, an outcome, a starting world) is imported, never written as a string outside the blueprint, except where the compiler checks it (an object's key, a computed member, the tag given to `catchTag`, `Match.tag` or `isTagged`).";

/** The blueprint, and its toolkit (packages/blueprint-tools), which writes and checks it. */
const OWNERS = ["packages/blueprint/**", "packages/blueprint-tools/**"];

/** Calls whose string arguments the compiler checks against the tags of the value they match. */
const TAG_CALLS = new Set(["catchTag", "tag", "tagStartsWith", "isTagged"]);

/** Nodes whose `key` is a name of the code's own, not a value. */
const KEYED = new Set([
  "Property",
  "PropertyDefinition",
  "MethodDefinition",
  "TSPropertySignature",
  "TSMethodSignature",
  "TSEnumMember",
]);

/** Nodes whose `source` is a module's specifier. */
const SOURCED = new Set(["ImportDeclaration", "ExportAllDeclaration", "ExportNamedDeclaration", "ImportExpression"]);

const message = (name: string): string =>
  `"${name}" is a name the blueprint declares: import it from @capxul/blueprint, never write it as a string`;

const isTagCall = (parent: ESTree.Node, node: ESTree.Node): boolean =>
  parent.type === "CallExpression" &&
  parent.callee !== node &&
  parent.callee.type === "MemberExpression" &&
  !parent.callee.computed &&
  parent.callee.property.type === "Identifier" &&
  TAG_CALLS.has(parent.callee.property.name);

/** True when the string at `node` is checked by the compiler, or is not a value at all. */
const exempt = (node: ESTree.Node): boolean => {
  const parent: ESTree.Node | null | undefined = node.parent;
  if (parent === null || parent === undefined) return false;
  if (KEYED.has(parent.type) && "key" in parent && parent.key === node) return true;
  if (SOURCED.has(parent.type) && "source" in parent && parent.source === node) return true;
  if (parent.type === "ImportSpecifier" || parent.type === "ExportSpecifier") return true;
  if (parent.type === "TSExternalModuleReference" || parent.type === "TSModuleDeclaration") return true;
  if (parent.type === "TaggedTemplateExpression") return true;
  if (parent.type === "MemberExpression" && parent.computed && parent.property === node) return true;
  return isTagCall(parent, node);
};

export const declaredNames = (names: ReadonlySet<string>, listed: Unmigrated) =>
  ratcheted("declared-names", description, listed, (context: Context, found) => {
    if (Arr.some(OWNERS, (owner) => matches(owner, pathOf(context))) || isGenerated(context)) return null;
    const check = (node: ESTree.Node, text: string | null): void => {
      if (text !== null && names.has(text) && !exempt(node)) found({ node, message: message(text) });
    };
    return {
      Literal: (node: ESTree.Node) => {
        if (node.type === "Literal" && typeof node.value === "string") check(node, node.value);
      },
      TemplateLiteral: (node: ESTree.TemplateLiteral) => {
        const only = node.quasis[0];
        if (node.expressions.length === 0 && only !== undefined) check(node, only.value.cooked);
      },
    };
  });
