/** The layout check as one pure function of what the entry read. Nothing here touches a file or the process. */
import { isSized, readmeProblems, sizeProblems, topLevelProblems } from "./internal/rules.ts";
import type { Policy, Problem, SourceFile, Tree } from "./types.ts";

export type * from "./types.ts";
export { isSized, readmeProblems, sizeProblems, topLevelProblems };

/** Every problem, in rule order. Empty means the layout holds. */
export const checkLayout = (tree: Tree, policy: Policy): Problem[] => {
  const files = tree.files.filter((p) => isSized(p, policy)).map((path): SourceFile => ({ path, lines: tree.linesOf(path) }));
  return [...topLevelProblems(tree, policy), ...sizeProblems(files, policy), ...readmeProblems(tree)];
};
