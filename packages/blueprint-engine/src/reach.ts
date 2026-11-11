// Small parsers and checks the build runs, kept out of build.ts so it stays within its size.

import type { AnyRecord, Finding, Link } from "./build.ts";

/**
 * The states a machine can reach: its initial state and any a creation move (one with no `from`: a row created in
 * that state) enters, then every state a move leads to from a reached one. A disconnected cycle or self-loop reaches
 * nothing.
 */
export const reachedStates = (m: AnyRecord): Set<string> => {
  const moves = Object.values(m.transitions as Record<string, { from: readonly string[]; to: string }>);
  const reached = new Set([m.initial as string, ...moves.filter((t) => t.from.length === 0).map((t) => t.to)]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const t of moves)
      if (!reached.has(t.to) && t.from.some((f) => reached.has(f))) { reached.add(t.to); grew = true; }
  }
  return reached;
};

/** Whether a link sends the event it points at: an emits list, or a machine's transition. A wait listens to an event;
 * a journey step's proof and a decision's affects only name it. */
export const sendsEvent = (l: Link): boolean => l.field === "emits" || (l.field === "transitions" && l.from.startsWith("machine:"));

/** A decision whose choice is not one of its options. */
export const chosenProblem = (d: AnyRecord): Finding | null => {
  const labels = ((d.options ?? []) as { label: string }[]).map((o) => o.label);
  return labels.includes(String(d.chosen))
    ? null
    : { record: `decision:${d.id}`, rule: "decision-chosen", detail: `chosen "${String(d.chosen)}" is not one of its options (${labels.join(", ") || "none"})` };
};

/** A chain event's argument names, read from its signature: `Transfer(address indexed from, address indexed to, uint256 value)`. */
export const argsOf = (signature: string): string[] => {
  const open = signature.indexOf("(");
  const body = open < 0 ? "" : signature.slice(open + 1, signature.lastIndexOf(")"));
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim().split(/\s+/).pop() ?? "").filter(Boolean);
};
