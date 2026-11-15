// capxul/no-json-text: payloads and results are typed values, never JSON text in a string to be parsed later
// (docs/roadmap.md, "The old thin line is not canon"). JSON text is allowed only in entry files and at the edges
// listed in .oxlintrc.json under settings.capxul.jsonEdges, each with a reason.
import type { Context, ESTree, Rule } from "@oxlint/plugins";
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import { memberName } from "./names.ts";
import { isListed } from "./where.ts";

/** What the rule finds, as AGENTS.md and packages/lint/README.md list it (written there by `pnpm generate`). */
export const description =
  "no `JSON.parse`, `JSON.stringify`, `Schema.parseJson` or string schema documented as JSON outside entry files and the edges listed under `settings.capxul.jsonEdges`.";

/** The calls that turn values into JSON text or back. */
const JSON_TEXT = new Set([
  "JSON.parse",
  "JSON.stringify",
  "Schema.parseJson",
  "Schema.fromJsonString",
  "Schema.UnknownFromJsonString",
]);

/** "JSON" as a word, but not the protocol name "JSON-RPC". */
const MENTIONS_JSON = /\bjson\b(?!-rpc)/i;

const message = (what: string): string =>
  `${what}: carry a typed value instead, or list this file as an edge in settings.capxul.jsonEdges with a reason`;

/** True when the expression is `Schema.String`, possibly piped, checked or annotated. */
const isStringSchema = (node: ESTree.Node | null | undefined): boolean => {
  if (node === null || node === undefined) return false;
  const name = memberName(node);
  if (name !== null) return name[0] === "Schema" && name[1] === "String";
  if (node.type === "CallExpression" && node.callee.type === "MemberExpression")
    return isStringSchema(node.callee.object);
  return false;
};

/** The text of an annotation argument such as `{ description: "JSON of the payload" }`. */
const annotationText = (node: ESTree.CallExpression): string =>
  pipe(
    Arr.flatMap(node.arguments, (argument) => (argument.type === "ObjectExpression" ? argument.properties : [])),
    Arr.flatMap((property) =>
      property.type === "Property" && property.value.type === "Literal" && typeof property.value.value === "string"
        ? [property.value.value]
        : [],
    ),
    Arr.join(" "),
  );

const create = (context: Context) => {
  if (isListed(context, "entries") || isListed(context, "jsonEdges")) return {};
  const commentsMentionJson = (node: ESTree.Node): boolean =>
    Arr.some(context.sourceCode.getCommentsBefore(node), (comment) => MENTIONS_JSON.test(comment.value));
  const documented = (node: ESTree.Node, holder: ESTree.Node): void => {
    if (isStringSchema(node) && commentsMentionJson(holder))
      context.report({ node, message: message("a string schema documented as JSON") });
  };
  return {
    MemberExpression: (node: ESTree.MemberExpression) => {
      const parts = memberName(node);
      const name = parts === null ? undefined : Arr.join(parts, ".");
      if (name !== undefined && JSON_TEXT.has(name)) context.report({ node, message: message(name) });
    },
    CallExpression: (node: ESTree.CallExpression) => {
      const callee = node.callee;
      if (callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") return;
      const annotates = callee.property.name === "annotate" || callee.property.name === "annotations";
      if (annotates && isStringSchema(callee.object) && MENTIONS_JSON.test(annotationText(node)))
        context.report({ node, message: message("a string schema documented as JSON") });
    },
    VariableDeclaration: (node: ESTree.VariableDeclaration) => {
      const holder = node.parent.type === "ExportNamedDeclaration" ? node.parent : node;
      for (const declarator of node.declarations) documented(declarator.init ?? declarator, holder);
    },
    Property: (node: ESTree.ObjectProperty) => documented(node.value, node),
  };
};

export const noJsonText: Rule = {
  meta: {
    type: "problem",
    docs: { description },
  },
  create,
};
