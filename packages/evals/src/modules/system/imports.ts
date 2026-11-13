// Where a file's imports lead: every module specifier from its syntax tree, resolved the way Node resolves it.
import { posix } from "node:path";
import ts from "typescript";

export interface Specifier { readonly specifier: string; readonly line: number }
type Exports = string | null | undefined | { readonly [key: string]: unknown };
export interface Package { readonly dir: string; readonly exports: Exports; readonly main?: string }

/** Every module a file names: import and export declarations (export * as ns included), import x = require(),
 * import("…") types, import() and require() calls, and new URL("…", import.meta.url), each with a string or a
 * substitution-free template argument. Comments and strings that merely look like imports are not imports. */
export const specifiersOf = (file: string, text: string): Specifier[] => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: Specifier[] = [];
  const add = (node: ts.Node | undefined): void => {
    if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)))
      found.push({ specifier: node.text, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
  };
  const metaUrl = (node: ts.Node | undefined): boolean => !!node && ts.isPropertyAccessExpression(node) && node.name.text === "url" &&
    ts.isMetaProperty(node.expression) && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === "require"))) add(node.arguments[0]);
    else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL" && metaUrl(node.arguments?.[1])) add(node.arguments?.[0]);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

// One export target: a string, or the first string among the import, node and default conditions.
const targetOf = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") for (const key of ["import", "node", "default"]) {
    const v = targetOf((value as Record<string, unknown>)[key]);
    if (v) return v;
  }
  return undefined;
};

/** The repository path a bare @capxul/<package>[/subpath] import loads, through the package's exports map (exact keys,
 * then one-* patterns; "." for the root), or, for a package without exports, its main or the subpath itself. */
export const resolvePackage = (specifier: string, packages: ReadonlyMap<string, Package>): string | null => {
  const m = /^(@capxul\/[^/]+)(\/.*)?$/.exec(specifier);
  const pkg = m ? packages.get(m[1]!) : undefined;
  if (!m || !pkg) return null;
  const sub = m[2] ? `.${m[2]}` : ".";
  let target: string | undefined;
  const exp = pkg.exports;
  if (exp === null || exp === undefined) target = sub === "." ? pkg.main ?? "./index.js" : sub;
  else if (typeof exp === "string") target = sub === "." ? exp : undefined;
  else {
    // An exports object whose keys are conditions, not subpaths, describes the root alone.
    const map: Record<string, unknown> = Object.keys(exp).some((k) => k.startsWith(".")) ? exp : { ".": exp };
    target = targetOf(map[sub]);
    for (const [key, value] of Object.entries(map)) {
      const star = key.indexOf("*");
      if (target || star < 0) continue;
      const [head, tail] = [key.slice(0, star), key.slice(star + 1)];
      if (sub.startsWith(head) && sub.endsWith(tail) && sub.length >= key.length - 1)
        target = targetOf(value)?.replace("*", sub.slice(head.length, sub.length - tail.length));
    }
  }
  return target ? posix.normalize(posix.join(pkg.dir, target)) : null;
};

/** A path without its source extension, so door.ts, door.js and an extensionless door name the same door. */
export const withoutExtension = (path: string): string => path.replace(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, "");
