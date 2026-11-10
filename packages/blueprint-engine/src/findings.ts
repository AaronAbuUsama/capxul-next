import type { Blueprint, Finding } from "./build.ts";

export interface StandingFinding extends Finding {
  readonly decision: string;
  readonly why: string;
}
import { deriveEvals } from "./evals.ts";
import { keyOf } from "./build.ts";

export const classifyFindings = (blueprint: Blueprint, gaps: Finding[], problems: Finding[]): Blueprint => {
  const records = blueprint.records;
  const standing: StandingFinding[] = [];
  const retained = new Set<Finding>();
  for (const decision of records.values()) {
    if (decision._kind !== "decision") continue;
    for (const entry of (decision.stands ?? []) as readonly { record: string; rule: string; why: string }[]) {
      const matches = gaps.filter((g) => g.record === entry.record && g.rule === entry.rule);
      if (!matches.length || !entry.why.trim()) {
        problems.push({ record: keyOf(decision), rule: "stale-standing-gap", detail: `${entry.record} ${entry.rule}: no matching gap or empty reason` });
        continue;
      }
      for (const gap of matches) {
        retained.add(gap);
        standing.push({ ...gap, decision: decision.id, why: entry.why });
      }
    }
  }
  const evals = deriveEvals(blueprint);
  const identities = new Map<string, (typeof evals)[number]>();
  for (const e of evals) {
    const first = identities.get(e.id);
    if (first) problems.push({ record: e.subject, rule: "eval-identity", detail: `${e.id} is used twice (first on ${first.subject})` });
    else identities.set(e.id, e);
  }
  return { ...blueprint, gaps: gaps.filter((g) => !retained.has(g)), standing, evals };
};
