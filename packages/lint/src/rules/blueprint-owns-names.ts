// capxul/blueprint-owns-names: an operation, a refusal (a tagged error), an event or a starting world is declared
// once, in packages/blueprint, and imported everywhere else, so two places cannot disagree about it
// (docs/roadmap.md, "One source for every fact").
import type { Context, ESTree, Rule } from "@oxlint/plugins";
import * as Arr from "effect/Array";
import { memberName, rootCallee } from "./names.ts";
import { matches, pathOf } from "./where.ts";

const OWNER = "packages/blueprint/**";

/** What each constructor declares, by its `Namespace.name`. */
const DECLARES: Readonly<Record<string, string>> = {
  "Rpc.make": "an operation",
  "Schema.TaggedError": "a refusal (a tagged error)",
  "Schema.TaggedErrorClass": "a refusal (a tagged error)",
  "Schema.ErrorClass": "a refusal (an error class)",
  "Data.TaggedError": "a refusal (a tagged error)",
  "Schema.TaggedClass": "an event (a tagged class)",
};

const message = (what: string): string =>
  `${what} is declared only in packages/blueprint; import it from there (docs/roadmap.md, "One source for every fact")`;

const isStartingWorld = (type: ESTree.TSType | undefined | null): boolean =>
  type?.type === "TSTypeReference" && type.typeName.type === "Identifier" && type.typeName.name === "StartingWorld";

const create = (context: Context) => {
  if (matches(OWNER, pathOf(context))) return {};
  return {
    CallExpression: (node: ESTree.CallExpression) => {
      if (node.parent.type === "CallExpression" && node.parent.callee === node) return;
      const name = memberName(rootCallee(node));
      const what = name === null ? undefined : DECLARES[Arr.join(name, ".")];
      if (what !== undefined) context.report({ node, message: message(what) });
    },
    VariableDeclarator: (node: ESTree.VariableDeclarator) => {
      if (node.id.type === "Identifier" && isStartingWorld(node.id.typeAnnotation?.typeAnnotation))
        context.report({ node, message: message("a starting world") });
    },
    TSSatisfiesExpression: (node: ESTree.TSSatisfiesExpression) => {
      if (isStartingWorld(node.typeAnnotation)) context.report({ node, message: message("a starting world") });
    },
  };
};

export const blueprintOwnsNames: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Operations, refusals, events and starting worlds are declared only in packages/blueprint" },
  },
  create,
};
