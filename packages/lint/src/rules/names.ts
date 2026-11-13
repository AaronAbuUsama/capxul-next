// Small readers of the syntax tree that the capxul rules share.
import type { ESTree } from "@oxlint/plugins";

/** `a.b` read as ["a", "b"] when both sides are plain names; null for anything else. */
export const memberName = (node: ESTree.Node): readonly [string, string] | null =>
  node.type === "MemberExpression" &&
  !node.computed &&
  node.object.type === "Identifier" &&
  node.property.type === "Identifier"
    ? [node.object.name, node.property.name]
    : null;

/** True when `node` is `object.property`. */
export const isMember = (node: ESTree.Node, object: string, property: string): boolean => {
  const name = memberName(node);
  return name !== null && name[0] === object && name[1] === property;
};

/** The callee of a call or a `new`, unwrapped from a curried call: `Schema.TaggedError<X>()("X", {})` gives `Schema.TaggedError`. */
export const rootCallee = (node: ESTree.Node): ESTree.Node =>
  node.type === "CallExpression" ? rootCallee(node.callee) : node;
