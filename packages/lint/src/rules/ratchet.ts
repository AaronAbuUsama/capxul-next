// The ratchet the typed-once rules share (docs/roadmap.md, "New formats by a ratchet"). A rule collects its findings
// in a file; at the end of the file they are compared with the file's count on the rule's unmigrated list
// (src/unmigrated.ts). A file not on the list reports every finding. A listed file with more findings than its count
// reports each of them, for the count must not grow; with fewer, it reports once that the count must be lowered; with
// exactly its count, nothing. A finding excused by a line override naming the rule with its reason
// (`// oxlint-disable-next-line capxul/<rule> -- <reason>`, or `disable-line`) is not counted, in a listed file or not:
// a reasoned override is the repository's sanctioned escape (AGENTS.md). It is still reported, so oxlint applies the
// override and the override is used. An override without a reason counts.
import type { Context, ESTree, Rule, Visitor } from "@oxlint/plugins";
import * as Arr from "effect/Array";
import * as Str from "effect/String";
import { pathOf } from "./where.ts";

/** One rule's unmigrated list: a file's path from the repository root, and how many findings it may still hold. */
export type Unmigrated = Readonly<Record<string, number>>;

/** What a rule found: where, and why. */
export type Finding = { readonly node: ESTree.Node; readonly message: string };

/** True when the file's first line is a comment starting `// Generated`: it is made by `pnpm generate`, never edited. */
export const isGenerated = (context: Context): boolean => Str.startsWith("// Generated")(context.sourceCode.text);

/** The override comment's form: its kind, the rules it names, and its reason after `--`. */
const OVERRIDE = /^\s*(?:oxlint|eslint)-disable-(next-line|line)\s+(.*?)\s+--\s*\S/u;

/** The lines on which `capxul/<name>` is overridden with a reason, in this file. */
const excusedLines = (context: Context, name: string): ReadonlySet<number> => {
  const rule = `capxul/${name}`;
  const lines = new Set<number>();
  for (const comment of context.sourceCode.getAllComments()) {
    const match = OVERRIDE.exec(comment.value);
    if (match === null) continue;
    const rules = Arr.map(Str.split(",")(match[2] ?? ""), Str.trim);
    if (!Arr.contains(rules, rule)) continue;
    lines.add(match[1] === "line" ? comment.loc.start.line : comment.loc.end.line + 1);
  }
  return lines;
};

/**
 * Builds a ratcheted rule. `visit` returns the rule's visitor, given a function that records one finding; it returns
 * null when the rule does not apply to this file at all.
 */
export const ratcheted = (
  name: string,
  description: string,
  listed: Unmigrated,
  visit: (context: Context, found: (finding: Finding) => void) => Visitor | null,
): Rule => ({
  meta: { type: "problem", docs: { description } },
  create: (context: Context) => {
    const findings: Array<Finding> = [];
    const visitor = visit(context, (finding) => findings.push(finding));
    if (visitor === null) return {};
    const path = pathOf(context);
    const allowed = listed[path];
    return {
      ...visitor,
      "Program:exit": () => {
        if (allowed === undefined) {
          for (const finding of findings) context.report(finding);
          return;
        }
        const excused = excusedLines(context, name);
        const isExcused = (finding: Finding) => excused.has(finding.node.loc.start.line);
        for (const finding of Arr.filter(findings, isExcused)) context.report(finding);
        const counted = Arr.filter(findings, (finding) => !isExcused(finding));
        const actual = counted.length;
        if (actual > allowed)
          for (const finding of counted)
            context.report({
              node: finding.node,
              message: `${finding.message}. ${path} is on capxul/${name}'s unmigrated list with ${String(allowed)}, which must not grow (it has ${String(actual)})`,
            });
        if (actual < allowed)
          context.report({
            loc: { line: 1, column: 0 },
            message: `capxul/${name} finds ${String(actual)} here, fewer than the ${String(allowed)} on its unmigrated list: lower it to ${String(actual)} in packages/lint/src/unmigrated.ts${actual === 0 ? " (by removing the entry)" : ""}`,
          });
      },
    };
  },
});
