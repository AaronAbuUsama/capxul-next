// Views generated from a blueprint: never drawn by hand. Mermaid for diagrams, Markdown for summaries.

import type { AnyRecord, Blueprint } from "./build.ts";

const ofKind = (b: Blueprint, kind: string) => [...b.records.values()].filter((r) => r._kind === kind);
const node = (id: string) => id.replace(/[^A-Za-z0-9_]/g, "_");

/** One state diagram per machine. */
export const machineDiagram = (m: AnyRecord): string => {
  const lines = ["stateDiagram-v2", `  [*] --> ${m.initial as string}`];
  for (const [name, t] of Object.entries(m.transitions as Record<string, { from: string[]; to: string }>))
    for (const f of t.from) lines.push(`  ${f} --> ${t.to}: ${name}`);
  for (const s of m.states as { id: string; terminal?: boolean }[]) if (s.terminal) lines.push(`  ${s.id} --> [*]`);
  return lines.join("\n");
};

/** Components and what they depend on. */
export const componentDiagram = (b: Blueprint): string => {
  const lines = ["flowchart LR"];
  for (const c of ofKind(b, "component")) {
    lines.push(`  ${node(c.id)}["${c.title as string}<br/><small>${c.runtime as string}</small>"]`);
    for (const d of (c.dependsOn as AnyRecord[]) ?? []) lines.push(`  ${node(c.id)} --> ${node(d.id)}`);
  }
  for (const i of ofKind(b, "integration")) {
    lines.push(`  ${node(`x_${i.id}`)}(["${i.system as string}"])`);
    lines.push(`  ${node((i.component as AnyRecord).id)} -.-> ${node(`x_${i.id}`)}`);
  }
  return lines.join("\n");
};

/** Concepts and their allowed dependencies. */
export const conceptDiagram = (b: Blueprint): string => {
  const lines = ["flowchart TB"];
  for (const c of ofKind(b, "concept")) {
    lines.push(`  ${node(c.id)}["${c.title as string}"]`);
    for (const d of (c.dependsOn as AnyRecord[]) ?? []) lines.push(`  ${node(c.id)} --> ${node(d.id)}`);
  }
  return lines.join("\n");
};

/** A concept's page: what it owns, what touches what, its gaps and evals. */
export const conceptPage = (b: Blueprint, ref: { readonly id: string }): string => {
  const key = `concept:${ref.id}`;
  const concept = b.records.get(key);
  if (!concept) throw new Error(`${key} is not in the blueprint`);
  const owned = (kind: string) => ofKind(b, kind).filter((r) => `concept:${(r.concept as AnyRecord)?.id}` === key);
  const tables = owned("table");
  const tableKeys = new Set(tables.map((t) => `table:${t.id}`));
  const machines = ofKind(b, "machine").filter((m) => tableKeys.has(`table:${(m.table as AnyRecord).id}`));
  const touched = new Set([key, ...tables.map((t) => `table:${t.id}`), ...machines.map((m) => `machine:${m.id}`)]);
  for (const k of ["rpc", "procedure", "workflow"]) for (const r of owned(k)) touched.add(`${k}:${r.id}`);
  const gaps = b.gaps.filter((g) => touched.has(g.record));
  const row = (r: AnyRecord) => `| \`${r.id}\` | ${String(r.title ?? "")} |`;
  return [
    `# ${concept.title as string}`,
    "",
    concept.about as string,
    "",
    `## Tables (${tables.length})`,
    "",
    "| Id | Title |",
    "|---|---|",
    ...tables.map(row),
    "",
    `## State machines (${machines.length})`,
    ...machines.flatMap((m) => ["", `### ${m.title as string}`, "", "```mermaid", machineDiagram(m), "```"]),
    "",
    `## Rpcs (${owned("rpc").length})`,
    "",
    "| Id | Title |",
    "|---|---|",
    ...owned("rpc").map(row),
    "",
    `## Procedures (${owned("procedure").length})`,
    "",
    "| Id | Title |",
    "|---|---|",
    ...owned("procedure").map(row),
    "",
    `## Workflows (${owned("workflow").length})`,
    "",
    "| Id | Title |",
    "|---|---|",
    ...owned("workflow").map(row),
    "",
    `## Gaps (${gaps.length})`,
    "",
    ...gaps.map((g) => `- \`${g.record}\` ${g.rule}: ${g.detail}`),
    "",
  ].join("\n");
};

/** The blueprint's front page: counts, problems, gaps by rule, and the two architecture diagrams. */
export const summaryPage = (b: Blueprint): string => {
  const counts = new Map<string, number>();
  for (const r of b.records.values()) counts.set(r._kind, (counts.get(r._kind) ?? 0) + 1);
  const byRule = new Map<string, number>();
  for (const g of b.gaps) byRule.set(g.rule, (byRule.get(g.rule) ?? 0) + 1);
  return [
    `# ${b.name} (${b.stage})`,
    "",
    `Records: ${[...counts].map(([k, n]) => `${k} ${n}`).join(", ")}. Evals: ${b.evals.length}. Problems: ${b.problems.length}. Gaps: ${b.gaps.length}. Standing: ${b.standing.length}.`,
    "",
    "## Components",
    "",
    "```mermaid",
    componentDiagram(b),
    "```",
    "",
    "## Concepts",
    "",
    "```mermaid",
    conceptDiagram(b),
    "```",
    "",
    "## Problems",
    "",
    ...(b.problems.length ? b.problems.map((p) => `- \`${p.record}\` ${p.rule}: ${p.detail}`) : ["None."]),
    "",
    `## Standing (${b.standing.length})`,
    "",
    ...b.standing.map((g) => `- \`${g.record}\` ${g.rule}: ${g.why} (decision: ${g.decision})`),
    "",
    "## Gaps by rule",
    "",
    ...[...byRule].map(([rule, n]) => `- ${rule}: ${n}`),
    "",
  ].join("\n");
};
