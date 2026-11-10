/** The plan as text for a terminal: what `plan show` prints. */
import type { Answer, LogEntry, Plan, Problem, Task, TaskState } from "../types.ts";
import { describe } from "./answers.ts";

const MARK: Readonly<Record<string, string>> = { todo: " ", current: ">", done: "x", doing: "~", blocked: "!", dropped: "-" };
const STATES: readonly TaskState[] = ["doing", "blocked", "todo", "done", "dropped"];

/** What a blocked task waits for, in a line. */
export const blockerLine = (t: Task): string => {
  const b = t.blockedBy;
  return !b ? "" : "decision" in b ? `decision ${b.decision}` : `${b.who}: ${b.need}`;
};

const taskLine = (t: Task): string =>
  `  [${MARK[t.state]}] ${t.id}  ${t.title}${t.thread ? `  (thread ${t.thread})` : ""}${t.state === "blocked" ? `  <- ${blockerLine(t)}` : ""}`;

export const show = (plan: Plan, problems: readonly Problem[] | null, answers: readonly Answer[] = []): string => {
  const note = plan.notes[plan.notes.length - 1];
  const title = (id: string): string => plan.tasks.find((t) => t.id === id)?.title ?? "(no such task)";
  const lines: string[] = [];
  if (answers.length) lines.push(`${answers.length} answers from Aaron to apply (pnpm plan answers):`, ...answers.map((a) => `  ${a.id}  ${a.target.kind} ${a.target.id}: ${describe(a)}`), "");
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

/** One task in full: its state, thread, links, its file as written, and its history in the log. */
export const showTask = (plan: Plan, id: string, file: string | null, log: readonly LogEntry[]): string => {
  const t = plan.tasks.find((x) => x.id === id);
  if (!t) return `no task ${id}`;
  const needing = plan.tasks.filter((x) => x.needs.includes(id)).map((x) => x.id);
  const mine = log.filter((l) => typeof l.args === "object" && l.args !== null && ((l.args as { id?: unknown }).id === id || ((l.args as { tasks?: unknown }).tasks as string[] | undefined)?.includes(id)));
  return [
    `${t.id}  ${t.title}`, `  milestone ${t.milestone} · ${t.state}${t.thread ? ` · thread ${t.thread}` : ""}${t.state === "blocked" ? ` · waiting: ${blockerLine(t)}` : ""}`,
    `  needs: ${t.needs.join(", ") || "nothing"} · needed by: ${needing.join(", ") || "nothing"} · created ${t.created}, updated ${t.updated}`,
    ...(t.records.length ? [`  records: ${t.records.join(", ")}`] : []), ...(t.evidence.length ? [`  evidence: ${t.evidence.join("; ")}`] : []), "",
    file ?? "(no file plan/tasks/" + id + ".md)", "", "History", ...mine.map((l) => `  ${l.at.slice(0, 16).replace("T", " ")}  ${l.by}  ${l.action}`),
  ].join("\n");
};
