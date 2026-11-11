/** The three layout rules, one function each. Pure: they see only what the entry read. */
import type { Policy, Problem, SourceFile, Tree } from "../types.ts";

/** Whether the size rule looks at this path: a source file outside the exempt places. */
export const isSized = (path: string, policy: Policy): boolean =>
  policy.sourceExtensions.some((e) => path.endsWith(e)) &&
  !policy.sizeExempt.some((x) => (x.startsWith("/") ? path.includes(x) : path.startsWith(x)));

/** Rule 1: every top-level entry is on the allowlist. */
export const topLevelProblems = (tree: Tree, policy: Policy): Problem[] =>
  [...tree.topLevel].sort().filter((e) => !(e in policy.allowed)).map((e) => ({
    rule: "top-level" as const, at: e,
    why: "it is not on the allowlist. Put it in the package it serves, under docs/, under archive/ (dead) or under var/ (working data); or add it to ALLOWED in packages/layout/src/main.ts with its reason",
  }));

/** Rule 2: no new file over the limit, no recorded offender grown, no entry left on the list that is no longer needed. */
export const sizeProblems = (files: readonly SourceFile[], policy: Policy): Problem[] => {
  const out: Problem[] = [], seen = new Map(files.map((f) => [f.path, f.lines] as const));
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const was = policy.oversize[f.path];
    if (was === undefined && f.lines > policy.limit) out.push({ rule: "size", at: f.path, why: `${f.lines} lines, over the limit of ${policy.limit}: split it` });
    if (was !== undefined && f.lines > was) out.push({ rule: "size", at: f.path, why: `grew from ${was} to ${f.lines} lines; it was already over ${policy.limit} and may only shrink` });
  }
  for (const [path, was] of Object.entries(policy.oversize).sort(([a], [b]) => a.localeCompare(b))) {
    const now = seen.get(path);
    if (now === undefined) out.push({ rule: "size", at: path, why: "it is on the oversize list but is gone or exempt: remove its line from packages/layout/oversize.json" });
    else if (now <= policy.limit) out.push({ rule: "size", at: path, why: `now ${now} lines (was ${was}): remove its line from packages/layout/oversize.json` });
  }
  return out;
};

/** Rule 3: a README.md in every top-level directory that is not hidden, and in every package. */
export const readmeProblems = (tree: Tree): Problem[] => {
  const present = new Set(tree.files);
  const dirs = [...tree.topLevelDirs.filter((d) => !d.startsWith(".")), ...tree.packages.map((p) => `packages/${p}`)].sort();
  return dirs.filter((d) => !present.has(`${d}/README.md`)).map((d) => ({
    rule: "readme" as const, at: d, why: "it has no README.md saying what it is, who writes it and what reads it",
  }));
};
