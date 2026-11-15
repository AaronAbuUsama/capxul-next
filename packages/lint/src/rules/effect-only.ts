// capxul/effect-only: TypeScript outside entry files is Effect. Promises, exceptions, the ambient clock, the
// environment and the console each have an Effect form (Effect.promise, Effect.fail, Clock, Config, Effect.log).
// Entry files are listed in .oxlintrc.json under settings.capxul.entries, each with a reason.
import type { Context, ESTree, Rule } from "@oxlint/plugins";
import { isMember, memberName } from "./names.ts";
import { isListed, isTypeScript } from "./where.ts";

/** What the rule finds, as AGENTS.md and packages/lint/README.md list it (written there by `pnpm generate`). */
export const description =
  "no `async`, `await`, `new Promise`, `try`, `throw`, `process.env`, `Date.now`, `new Date()` or `console` in TypeScript outside entry files. Entry files are listed in `.oxlintrc.json` under `settings.capxul.entries`, each with its reason.";

const MESSAGE = (what: string, instead: string): string =>
  `${what} is not Effect; use ${instead}, or list this file as an entry in settings.capxul.entries with a reason`;

const create = (context: Context) => {
  if (!isTypeScript(context) || isListed(context, "entries")) return {};
  const report = (node: ESTree.Node, what: string, instead: string): void =>
    context.report({ node, message: MESSAGE(what, instead) });
  const asyncFunction = (node: ESTree.Function | ESTree.ArrowFunctionExpression): void => {
    if (node.async) report(node, "an async function", "Effect.gen or Effect.fn");
  };
  return {
    FunctionDeclaration: asyncFunction,
    FunctionExpression: asyncFunction,
    ArrowFunctionExpression: asyncFunction,
    AwaitExpression: (node: ESTree.AwaitExpression) => report(node, "await", "yield* inside Effect.gen"),
    ForOfStatement: (node: ESTree.ForOfStatement) => {
      if (node.await) report(node, "for await", "Stream");
    },
    TryStatement: (node: ESTree.TryStatement) => report(node, "try", "Effect.try or Effect.catch"),
    ThrowStatement: (node: ESTree.ThrowStatement) => report(node, "throw", "Effect.fail or Effect.die"),
    NewExpression: (node: ESTree.NewExpression) => {
      if (node.callee.type !== "Identifier") return;
      if (node.callee.name === "Promise") report(node, "new Promise", "Effect.async or Effect.promise");
      if (node.callee.name === "Date" && node.arguments.length === 0) report(node, "new Date()", "Clock");
    },
    MemberExpression: (node: ESTree.MemberExpression) => {
      if (isMember(node, "process", "env")) report(node, "process.env", "Config");
      if (isMember(node, "Date", "now")) report(node, "Date.now", "Clock");
      if (memberName(node)?.[0] === "console") report(node, "console", "Effect.log");
    },
  };
};

export const effectOnly: Rule = {
  meta: {
    type: "problem",
    docs: { description },
  },
  create,
};
