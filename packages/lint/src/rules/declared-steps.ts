// capxul/declared-steps: every effectful function of our own code is a span named by a step the blueprint declares
// (docs/roadmap.md, step 4.1; AGENTS.md, "Who owns each fact"). It applies to Core, the world, the platform package
// and the runner's plumbing (its generic checks in src/checks/ excepted), and skips tests, entry files and generated
// files. Library spans (`postgres`, HTTP `GET`, `rpc`, ...) are made by libraries, not by our code, and are not its
// concern; nor are `Effect.withSpan` and `Effect.makeSpan`, which the run-time checks judge by their names.
//
// It finds two things:
//
// 1. `Effect.fn` given a string or a template as its name, or given no name (`Effect.fn(function* ...)`). The name must
//    be an expression, such as `Pipeline.clusterUp.name`, read from what the blueprint declares; the rule cannot see
//    where an expression comes from, so the reviewer and the run-time checks judge that it is a declared step.
// 2. A function that does work without a span. A function "does work" when it is declared at the top level of its
//    module (exported or not: a function declaration, or a `const` holding an arrow or a function expression) and it
//    returns an Effect built from `Effect.gen`: its body is `Effect.gen(...)`, or a return statement of its own body
//    returns `Effect.gen(...)`, that piped (`Effect.gen(...).pipe(...)`, `pipe(Effect.gen(...), ...)`), or that given
//    to an `Effect.*` combinator as its first argument. One piped through `Effect.withSpan` with a name that is not a
//    string is a span, and passes. A top-level `Effect.fnUntraced(...)` is always found: a function with no span.
//    Not counted: a constant Effect (`const x = Effect.gen(...)`), a Layer (`Layer.effect(T, Effect.gen(...))`, even
//    when a function returns it), a schema, a pure helper, and a function nested in another or held in an object or
//    a class, whose module-level owner is the span.
import type { Context, ESTree } from "@oxlint/plugins";
import * as Arr from "effect/Array";
import { isGenerated, ratcheted, type Unmigrated } from "./ratchet.ts";
import { isListed, isTypeScript, matches, pathOf } from "./where.ts";

/** What the rule finds, as AGENTS.md and packages/lint/README.md list it (written there by `pnpm generate`). */
export const description =
  "every effectful function of Core, the world, the platform and the runner (outside its checks) is `Effect.fn` named by a declared step, imported from the blueprint: no string name, and no top-level function returning `Effect.gen(...)` without a span.";

/** Our own code, whose work the run's record must explain. */
const SCOPE = ["packages/core/**", "packages/world/**", "packages/platform/**", "packages/runner/**"];

/** Inside the scope, what is not the work being measured: the runner's generic checks (which judge it), and tests. */
const EXEMPT = ["packages/runner/src/checks/**", "packages/*/test/**", "**/*.test.ts"];

const STRING_NAME =
  "Effect.fn is named by a string: name it by a step the blueprint declares, imported from @capxul/blueprint (`Pipeline`, or the operation's declared steps)";
const NO_NAME =
  "Effect.fn has no name: give it a step the blueprint declares, imported from @capxul/blueprint (`Pipeline`, or the operation's declared steps)";
const UNTRACED =
  "Effect.fnUntraced at the top level is a function that does work with no span: use Effect.fn named by a declared step";
const unspanned = (name: string): string =>
  `${name} returns an Effect built from Effect.gen with no span: write it as Effect.fn named by a step the blueprint declares, imported from @capxul/blueprint`;

/** True when `node` is `Effect.<name>`. */
const isEffect = (node: ESTree.Node, name: string): boolean =>
  node.type === "MemberExpression" &&
  !node.computed &&
  node.object.type === "Identifier" &&
  node.object.name === "Effect" &&
  node.property.type === "Identifier" &&
  node.property.name === name;

/** True when `node` is `Effect.<something>`, and gives the something. */
const effectMember = (node: ESTree.Node): string | null =>
  node.type === "MemberExpression" &&
  !node.computed &&
  node.object.type === "Identifier" &&
  node.object.name === "Effect" &&
  node.property.type === "Identifier"
    ? node.property.name
    : null;

/** True when `node` is a string written in the code: a string literal, or a template. */
const isWritten = (node: ESTree.Node | undefined): boolean =>
  node !== undefined &&
  ((node.type === "Literal" && typeof node.value === "string") || node.type === "TemplateLiteral");

const isFunction = (node: ESTree.Node | undefined): boolean =>
  node !== undefined && (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression");

/** The expression under any type assertion or parentheses. */
const bare = (node: ESTree.Node): ESTree.Node => {
  let at = node;
  while (
    at.type === "TSAsExpression" ||
    at.type === "TSSatisfiesExpression" ||
    at.type === "TSNonNullExpression" ||
    at.type === "ParenthesizedExpression"
  )
    at = at.expression;
  return at;
};

/** True when `node` is `Effect.withSpan(name)` or `Effect.withSpan(effect, name)` with a name that is not written. */
const isSpan = (node: ESTree.Node): boolean => {
  const at = bare(node);
  if (at.type !== "CallExpression" || !isEffect(at.callee, "withSpan")) return false;
  const name = at.arguments.length >= 2 ? at.arguments[1] : at.arguments[0];
  return name !== undefined && name.type !== "SpreadElement" && !isWritten(name);
};

/**
 * What `node` is, as the rule sees it: "work" when it is an Effect built from `Effect.gen` with no span, "span" when it
 * is one given a span, and null otherwise.
 */
const built = (node: ESTree.Node): "work" | "span" | null => {
  const at = bare(node);
  if (at.type !== "CallExpression") return null;
  const callee = at.callee;
  const first = at.arguments[0];
  if (isEffect(callee, "gen")) return "work";
  // `x.pipe(...)`: built from `x`, with a span when one of the pipe's steps is one.
  if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") {
    if (callee.property.name === "pipe") {
      const from = built(callee.object);
      if (from === null) return null;
      return from === "span" || Arr.some(at.arguments, isSpan) ? "span" : "work";
    }
  }
  if (first === undefined || first.type === "SpreadElement") return null;
  // `pipe(x, ...)`.
  if (callee.type === "Identifier" && callee.name === "pipe") {
    const from = built(first);
    if (from === null) return null;
    return from === "span" || Arr.some(Arr.drop(at.arguments, 1), isSpan) ? "span" : "work";
  }
  // `Effect.withSpan(x, name)` and every other `Effect.*(x, ...)`.
  if (effectMember(callee) !== null) {
    const from = built(first);
    if (from === null) return null;
    return from === "span" || isSpan(at) ? "span" : "work";
  }
  return null;
};

/** The expressions a function's own body returns, not those of the functions nested in it. */
const returned = (body: ESTree.Node): ReadonlyArray<ESTree.Node> => {
  if (body.type !== "BlockStatement") return [body];
  const out: Array<ESTree.Node> = [];
  const walk = (statement: ESTree.Node | null | undefined): void => {
    if (statement === null || statement === undefined) return;
    switch (statement.type) {
      case "ReturnStatement":
        if (statement.argument !== null) out.push(statement.argument);
        return;
      case "BlockStatement":
        for (const inner of statement.body) walk(inner);
        return;
      case "IfStatement":
        walk(statement.consequent);
        walk(statement.alternate);
        return;
      case "SwitchStatement":
        for (const branch of statement.cases) for (const inner of branch.consequent) walk(inner);
        return;
      default:
        return;
    }
  };
  walk(body);
  return out;
};

/** True when the function does work with no span. */
const doesWork = (fn: ESTree.Node): boolean =>
  (fn.type === "ArrowFunctionExpression" || fn.type === "FunctionExpression" || fn.type === "FunctionDeclaration") &&
  fn.body !== null &&
  fn.body !== undefined &&
  Arr.some(returned(fn.body), (expression) => built(expression) === "work");

/** True when `node` is a top-level `Effect.fnUntraced(...)`, or one called again (`Effect.fnUntraced(...)(...)`). */
const isUntraced = (node: ESTree.Node): boolean => {
  const at = bare(node);
  if (at.type !== "CallExpression") return false;
  return isEffect(at.callee, "fnUntraced") || (at.callee.type === "CallExpression" && isUntraced(at.callee));
};

export const declaredSteps = (listed: Unmigrated) =>
  ratcheted("declared-steps", description, listed, (context: Context, found) => {
    const path = pathOf(context);
    if (
      !isTypeScript(context) ||
      !Arr.some(SCOPE, (pattern) => matches(pattern, path)) ||
      Arr.some(EXEMPT, (pattern) => matches(pattern, path)) ||
      isListed(context, "entries") ||
      isGenerated(context)
    )
      return null;
    /** One top-level declaration: a function, or a `const` holding one. */
    const declared = (node: ESTree.Node | null | undefined): void => {
      if (node === null || node === undefined) return;
      if (node.type === "FunctionDeclaration") {
        if (doesWork(node)) found({ node, message: unspanned(node.id?.name ?? "This function") });
        return;
      }
      if (node.type === "VariableDeclaration")
        for (const declarator of node.declarations) {
          const init = declarator.init;
          if (init === null || init === undefined) continue;
          const name = declarator.id.type === "Identifier" ? declarator.id.name : "This function";
          const value = bare(init);
          if (isFunction(value) && doesWork(value)) found({ node: declarator, message: unspanned(name) });
          else if (isUntraced(value)) found({ node: declarator, message: UNTRACED });
        }
      if (node.type === "ExportDefaultDeclaration") {
        const value = node.declaration;
        if (isFunction(value) || value.type === "FunctionDeclaration") {
          if (doesWork(value)) found({ node, message: unspanned("The default export") });
        } else if (value.type !== "ClassDeclaration" && value.type !== "TSInterfaceDeclaration" && isUntraced(value))
          found({ node, message: UNTRACED });
      }
    };
    return {
      Program: (program: ESTree.Program) => {
        for (const statement of program.body)
          declared(statement.type === "ExportNamedDeclaration" ? statement.declaration : statement);
      },
      CallExpression: (node: ESTree.CallExpression) => {
        if (!isEffect(node.callee, "fn")) return;
        const name = node.arguments[0];
        if (isWritten(name)) found({ node, message: STRING_NAME });
        else if (name === undefined || isFunction(name)) found({ node, message: NO_NAME });
      },
    };
  });
