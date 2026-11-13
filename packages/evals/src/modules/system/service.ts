// sys:imports/<concept> and sys:generated, judged statically from the build's own commit (system.eval-system-checks).
import { execFileSync } from "node:child_process";
import { posix } from "node:path";
import type { Blueprint } from "@capxul/blueprint-engine";
import { resolvePackage, specifiersOf, withoutExtension, type Package } from "./imports.ts";

export interface SystemCheck { readonly id: string; readonly name: string; readonly concept?: string }
export interface Violation { readonly file: string; readonly line: number; readonly specifier: string; readonly reaches: string; readonly why: string }
export interface ImportsJudgement { readonly pass: boolean; readonly detail: string; readonly files: readonly string[]; readonly violations: readonly Violation[] }

/** One check per requested sys eval, named from the blueprint. */
export const systemChecks = (b: Pick<Blueprint, "evals">, ids: readonly string[]): SystemCheck[] =>
  ids.flatMap((id) => {
    if (!b.evals.some((e) => e.id === id)) return [];
    const m = /^sys:imports\/([^/]+)$/.exec(id);
    if (m) return [{ id, name: `SYSTEM.imports.${m[1]}`, concept: m[1]! }];
    return id === "sys:generated" ? [{ id, name: "SYSTEM.generated" }] : [];
  });

/** The commit's files, read from git so an uncommitted change can never stand in for the build under test. */
export const treeAt = (root: string, commit: string): { files: string[]; read: (path: string) => string } => {
  const files = execFileSync("git", ["ls-tree", "-r", "--name-only", commit, "packages"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\n").filter(Boolean);
  return { files, read: (path) => execFileSync("git", ["show", `${commit}:${path}`], { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 }) };
};

const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** The concept folder a repository path lies in: packages/<package>/src/<concept>/…, else null. */
export const conceptOf = (path: string, concepts: ReadonlySet<string>): { pkg: string; concept: string } | null => {
  const m = /^packages\/([^/]+)\/src\/([^/]+)\//.exec(path);
  return m && concepts.has(m[2]!) ? { pkg: m[1]!, concept: m[2]! } : null;
};

/** Passes when the concept has TypeScript under some packages/<package>/src/<concept>/, and every file there imports
 * another concept's code only from that concept's src/<other>/door.ts, and only a concept it depends on. */
export const judgeImports = (b: Pick<Blueprint, "records">, concept: string, tree: { files: readonly string[]; read: (path: string) => string }): ImportsJudgement => {
  const concepts = new Set([...b.records.keys()].filter((k) => k.startsWith("concept:")).map((k) => k.slice("concept:".length)));
  const record = b.records.get(`concept:${concept}`) as { dependsOn?: readonly { id: string }[] } | undefined;
  if (!record) return { pass: false, detail: `the blueprint declares no concept ${concept}`, files: [], violations: [] };
  const allowed = new Set((record.dependsOn ?? []).map((d) => d.id));
  const packages = new Map(tree.files.filter((f) => /^packages\/[^/]+\/package\.json$/.test(f)).flatMap((f) => {
    try {
      const json = JSON.parse(tree.read(f)) as { name?: string; exports?: Package["exports"]; main?: string };
      return json.name ? [[json.name, { dir: posix.dirname(f), exports: json.exports, ...(json.main ? { main: json.main } : {}) }] as const] : [];
    } catch { return []; }
  }));
  const files = tree.files.filter((f) => SOURCE.test(f) && conceptOf(f, concepts)?.concept === concept);
  if (!files.length) return { pass: false, detail: `no TypeScript or JavaScript under packages/*/src/${concept}/, so its imports cannot be checked`, files, violations: [] };
  const violations: Violation[] = [];
  for (const file of files) {
    for (const { specifier, line } of specifiersOf(file, tree.read(file))) {
      // Relative paths resolve against the file; @capxul/<package> imports through that package's exports map.
      const target = specifier.startsWith(".") ? posix.normalize(posix.join(posix.dirname(file), specifier)) : resolvePackage(specifier, packages);
      const other = target ? conceptOf(target, concepts) : null;
      if (!other || other.concept === concept) continue;
      const reaches = `${other.concept} (${target})`;
      if (!allowed.has(other.concept)) violations.push({ file, line, specifier, reaches, why: `${concept} does not depend on ${other.concept}` });
      else if (withoutExtension(target!) !== `packages/${other.pkg}/src/${other.concept}/door`) violations.push({ file, line, specifier, reaches, why: `not through ${other.concept}'s door.ts` });
    }
  }
  const detail = violations.length
    ? `${violations.length} imports break the rule, first ${violations[0]!.file}:${violations[0]!.line} → ${violations[0]!.reaches}: ${violations[0]!.why}`
    : `${files.length} files import other concepts only through the doors of ${[...allowed].sort().join(", ") || "none"}`;
  return { pass: !violations.length, detail, files, violations };
};

/** sys:generated: regenerating every packages/<package>/src/generated/ from the records gives no diff and compiles. Until the
 * generator (packages/generate) exists at the commit, nothing can regenerate, so the claim fails with that reason. */
export const judgeGenerated = (tree: { files: readonly string[] }, commit: string): { pass: boolean; detail: string; generated: readonly string[] } => {
  const generated = tree.files.filter((f) => /^packages\/[^/]+\/src\/generated\//.test(f));
  const generator = tree.files.some((f) => f.startsWith("packages/generate/"));
  return { pass: false, generated, detail: generator
    ? `packages/generate exists at ${commit}, but this check does not run it yet (${generated.length} generated files); extend system.eval-system-checks`
    : `packages/generate does not exist at ${commit}, so nothing regenerates the ${generated.length} files under src/generated/` };
};
