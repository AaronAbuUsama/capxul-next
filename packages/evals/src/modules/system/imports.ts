// Where a file's imports lead: every module specifier from its syntax tree, resolved the way Node resolves it.
import { posix } from "node:path";
import ts from "typescript";

/** A module a file names. specifier is null when the argument of import(), require() or import.meta.resolve() is not a
 * literal, so no static reading can say what it loads. kind is how Node resolves it: require() and import = require()
 * match the require condition, everything else the import condition. */
export interface Specifier { readonly specifier: string | null; readonly line: number; readonly kind: "import" | "require" }
type Exports = string | null | undefined | readonly unknown[] | { readonly [key: string]: unknown };
export interface Package { readonly dir: string; readonly exports: Exports; readonly main?: string }

/** Every module a file names: import and export declarations (export * as ns included), import x = require(),
 * import("…") types, import(), require() and import.meta.resolve() calls, and new URL("…", import.meta.url), each with
 * a string or a substitution-free template argument. Comments and strings that merely look like imports are not imports. */
export const specifiersOf = (file: string, text: string): Specifier[] => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: Specifier[] = [];
  const lineOf = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const literal = (node: ts.Node | undefined): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
    !!node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
  const add = (node: ts.Node | undefined, kind: Specifier["kind"] = "import"): void => {
    if (literal(node)) found.push({ specifier: node.text, line: lineOf(node), kind });
  };
  // A call that loads or resolves a module must name it literally, or it is recorded as unjudgeable.
  const call = (node: ts.CallExpression, kind: Specifier["kind"]): void => {
    const arg = node.arguments[0];
    if (literal(arg)) add(arg, kind);
    else found.push({ specifier: null, line: lineOf(node), kind });
  };
  const importMeta = (node: ts.Node | undefined): boolean => !!node && ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword;
  const metaUrl = (node: ts.Node | undefined): boolean => !!node && ts.isPropertyAccessExpression(node) && node.name.text === "url" && importMeta(node.expression);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression, "require");
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) call(node, "import");
    else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") call(node, "require");
    else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "resolve" &&
      importMeta(node.expression.expression)) call(node, "import");
    else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL" && metaUrl(node.arguments?.[1])) add(node.arguments?.[0]);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

// The conditions Node matches by default for each kind of load; "default" always matches.
const CONDITIONS = {
  import: new Set(["node", "import", "module-sync", "node-addons", "default"]),
  require: new Set(["node", "require", "module-sync", "node-addons", "default"]),
} as const;

/** One export target as Node resolves it: a "./" string; an array's first entry that resolves; or, for a conditions
 * object, the first key in object order that the load matches. null is an explicit exclusion; undefined, no match. */
const targetOf = (value: unknown, kind: Specifier["kind"]): string | null | undefined => {
  if (typeof value === "string") return value.startsWith("./") ? value : undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    for (const v of value) { const t = targetOf(v, kind); if (t !== undefined) return t; }
    return undefined;
  }
  if (typeof value === "object") for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (!CONDITIONS[kind].has(key)) continue;
    const t = targetOf(v, kind);
    if (t !== undefined) return t;
  }
  return undefined;
};

/** The repository path a bare @capxul/<package>[/subpath] import loads, through the package's exports map (an exact key,
 * else the pattern with the longest prefix; "." for the root), or, for a package without exports, its main or the
 * subpath itself. null when Node would load nothing: an unknown package, a subpath the map does not export, or a
 * target no condition of this load matches. */
export const resolvePackage = (specifier: string, packages: ReadonlyMap<string, Package>, kind: Specifier["kind"] = "import"): string | null => {
  const m = /^(@capxul\/[^/]+)(\/.*)?$/.exec(specifier);
  const pkg = m ? packages.get(m[1]!) : undefined;
  if (!m || !pkg) return null;
  const sub = m[2] ? `.${m[2]}` : ".";
  let target: string | null | undefined;
  const exp = pkg.exports;
  if (exp === null || exp === undefined) target = sub === "." ? pkg.main ?? "./index.js" : sub;
  else if (typeof exp === "string" || Array.isArray(exp)) target = sub === "." ? targetOf(exp, kind) : undefined;
  else {
    // An exports object whose keys are conditions, not subpaths, describes the root alone.
    const map: Record<string, unknown> = Object.keys(exp).some((k) => k.startsWith(".")) ? exp as Record<string, unknown> : { ".": exp };
    if (Object.hasOwn(map, sub) && !sub.includes("*")) target = targetOf(map[sub], kind);
    else {
      let best: { head: string; value: unknown; star: string } | undefined;
      for (const [key, value] of Object.entries(map)) {
        const star = key.indexOf("*");
        if (star < 0 || star !== key.lastIndexOf("*")) continue;
        const [head, tail] = [key.slice(0, star), key.slice(star + 1)];
        if (sub.startsWith(head) && sub !== head && sub.endsWith(tail) && sub.length >= key.length && (!best || head.length > best.head.length))
          best = { head, value, star: sub.slice(head.length, sub.length - tail.length) };
      }
      const t = best ? targetOf(best.value, kind) : undefined;
      target = typeof t === "string" ? t.replaceAll("*", best!.star) : t;
    }
  }
  return typeof target === "string" ? posix.normalize(posix.join(pkg.dir, target)) : null;
};

/** A path without its source extension, so door.ts, door.js and an extensionless door name the same door. */
export const withoutExtension = (path: string): string => path.replace(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, "");
