// capxul/import-door: another package is imported only through its door, `src/door.ts` (`src/index.ts` in the
// blueprint and its toolkit, the glossary's word for it), or by its bare name `@capxul/<name>`, whose package.json
// points at that door. Everything else in a package is its own business.
import type { Context, ESTree, Rule } from "@oxlint/plugins";
import * as Arr from "effect/Array";
import * as Str from "effect/String";
import { pathOf } from "./where.ts";

/** The file a package's door is: today `src/door.ts`, and `src/index.ts` once renamed by the glossary. */
const DOORS = ["src/door.ts", "src/index.ts"];

/** Joins a relative specifier to the importing file's folder, resolving `.` and `..`. */
export const resolve = (from: string, specifier: string): string =>
  Arr.join(
    Arr.reduce(
      [...Arr.dropRight(Str.split(from, "/"), 1), ...Str.split(specifier, "/")],
      Arr.empty<string>(),
      (parts, part) => {
        if (part === "..") return Arr.dropRight(parts, 1);
        return part === "." || part === "" ? parts : Arr.append(parts, part);
      },
    ),
    "/",
  );

const packageOf = (path: string): string | null => /^packages\/([^/]+)\//.exec(path)?.[1] ?? null;

/** Why this import passes another package's door, or null when it does not. */
export const throughWall = (file: string, specifier: string): string | null => {
  const bare = /^@capxul\/([^/]+)\/(.+)$/.exec(specifier);
  if (bare !== null) return `"${specifier}" reaches inside @capxul/${bare[1]}; import "@capxul/${bare[1]}" instead`;
  if (!Str.startsWith(".")(specifier)) return null;
  const target = resolve(file, specifier);
  const own = packageOf(file);
  const other = packageOf(target);
  if (other === null || other === own) return null;
  const doors = Arr.map(DOORS, (door) => `packages/${other}/${door}`);
  return Arr.some(doors, (door) => target === door || target === Str.replace(/\.ts$/, "")(door))
    ? null
    : `"${specifier}" reaches inside packages/${other}; import its door, packages/${other}/${DOORS[0] ?? ""}`;
};

type WithSource = ESTree.ImportDeclaration | ESTree.ExportAllDeclaration | ESTree.ExportNamedDeclaration;

const create = (context: Context) => {
  const file = pathOf(context);
  const check = (node: ESTree.Node, source: ESTree.Node | null | undefined): void => {
    if (source?.type !== "Literal" || typeof source.value !== "string") return;
    const why = throughWall(file, source.value);
    if (why !== null) context.report({ node, message: why });
  };
  const declaration = (node: WithSource): void => check(node, node.source);
  return {
    ImportDeclaration: declaration,
    ExportAllDeclaration: declaration,
    ExportNamedDeclaration: declaration,
    ImportExpression: (node: ESTree.ImportExpression) => check(node, node.source),
  };
};

export const importDoor: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Another package is imported only through its door, src/door.ts or src/index.ts" },
  },
  create,
};
