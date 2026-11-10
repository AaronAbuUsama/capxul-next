/** The plan as text for a terminal: what `plan show` prints. */
import type { Facts, Plan, Problem, Task, TaskState } from "../types.ts";

const MARK: Readonly<Record<string, string>> = { todo: " ", current: ">", done: "x", doing: "~", blocked: "!", dropped: "-" };
const STATES: readonly TaskState[] = ["doing", "blocked", "todo", "done", "dropped"];

/** What a blocked task waits for, in a line. */
export const blockerLine = (t: Task): string => {
  const b = t.blockedBy;
  return !b ? "" : "decision" in b ? `decision ${b.decision}` : `${b.who}: ${b.need}`;
};

const taskLine = (t: Task): string =>
  `  [${MARK[t.state]}] ${t.id}  ${t.title}${t.thread ? `  (thread ${t.thread})` : ""}${t.state === "blocked" ? `  <- ${blockerLine(t)}` : ""}`;

export const show = (plan: Plan, problems: readonly Problem[] | null, _facts?: Facts): string => {
  const note = plan.notes[plan.notes.length - 1];
  const title = (id: string): string => plan.tasks.find((t) => t.id === id)?.title ?? "(no such task)";
  const lines: string[] = [];
  if (note) lines.push(`Note, ${note.date} (${note.by}): ${note.text}`, "");
  lines.push(`Goal: ${plan.goal.title}`, `  ${plan.goal.why}`);
  for (const e of plan.goal.exit) lines.push(`  [${e.state === "met" ? "x" : " "}] ${e.id}  ${e.claim}`);
  lines.push("", "Milestones");
  for (const m of [...plan.milestones].sort((a, b) => a.order - b.order)) {
    const open = m.exit.filter((e) => e.state === "open").length;
    lines.push(` [${MARK[m.state]}] ${m.id}  ${m.title}  (${m.state}; ${m.exit.length - open} of ${m.exit.length} exits met; ${plan.tasks.filter((t) => t.milestone === m.id && t.state !== "dropped").length} tasks)`);
  }
  lines.push("", `Critical path (written ${plan.path.written || "never"})`, ...plan.path.tasks.map((id, i) => `  ${i + 1}. ${id}  ${title(id)}`), `  why: ${plan.path.why}`);
  for (const s of STATES) {
    const held = plan.tasks.filter((t) => t.state === s);
    if (held.length) lines.push("", `${s[0]?.toUpperCase()}${s.slice(1)} (${held.length})`, ...held.map(taskLine));
  }
  if (problems !== null) lines.push("", problems.length === 0 ? "check: 0 problems" : `check: ${problems.length} problems`, ...problems.map((p) => `  ${p.at}: ${p.why}`));
  return lines.join("\n");
};
