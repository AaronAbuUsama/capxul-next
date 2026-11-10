/** The owner's answers: reading `plan/answers.jsonl` and the log, and saying which are still to apply. Nothing is written here. */
import type { Answer, AnswerLine, How, LogEntry, Result, Target } from "../types.ts";

const isFields = (u: unknown): u is Readonly<Record<string, unknown>> => typeof u === "object" && u !== null && !Array.isArray(u);

const howOf = (u: unknown): How | null => {
  if (!isFields(u)) return null;
  const text = typeof u["text"] === "string" ? u["text"] : null;
  switch (u["how"]) {
    case "accept": case "done": return { how: u["how"] };
    case "choose": return typeof u["option"] === "string" ? { how: "choose", option: u["option"] } : null;
    case "change": case "text": return text === null ? null : { how: u["how"], text };
    default: return null;
  }
};

/** The lines of answers.jsonl that are answers or withdrawals; any other line is ignored, never repaired. */
export const parseAnswerLines = (text: string): readonly AnswerLine[] =>
  text.split("\n").flatMap((raw): AnswerLine[] => {
    if (raw.trim() === "") return [];
    try {
      const u: unknown = JSON.parse(raw);
      if (!isFields(u) || typeof u["id"] !== "string" || typeof u["at"] !== "string") return [];
      if (u["type"] === "withdraw" && typeof u["answer"] === "string") return [{ type: "withdraw", id: u["id"], at: u["at"], answer: u["answer"] }];
      const t = u["target"];
      const how = howOf(u["answer"]);
      if (u["type"] === "answer" && isFields(t) && (t["kind"] === "decision" || t["kind"] === "task") && typeof t["id"] === "string" && how)
        return [{ type: "answer", id: u["id"], at: u["at"], target: { kind: t["kind"], id: t["id"] }, answer: how }];
      return [];
    } catch {
      return [];
    }
  });

/** The ids of answers the log says were applied: `answers.apply` entries. */
export const appliedIds = (log: readonly LogEntry[]): ReadonlySet<string> =>
  new Set(log.flatMap((l) => (l.action === "answers.apply" && isFields(l.args) && typeof l.args["answer"] === "string" ? [l.args["answer"]] : [])));

/** The targets of applied answers, as the log recorded them. */
export const appliedTargets = (log: readonly LogEntry[]): readonly Target[] =>
  log.flatMap((l) => {
    const t = l.action === "answers.apply" && isFields(l.args) ? l.args["target"] : undefined;
    return isFields(t) && (t["kind"] === "decision" || t["kind"] === "task") && typeof t["id"] === "string" ? [{ kind: t["kind"], id: t["id"] }] : [];
  });

/** Answers not withdrawn and not applied, oldest first. Applied state is in the log, so the answers file stays append only. */
export const unapplied = (lines: readonly AnswerLine[], log: readonly LogEntry[]): readonly Answer[] => {
  const withdrawn = new Set(lines.flatMap((l) => (l.type === "withdraw" ? [l.answer] : [])));
  const applied = appliedIds(log);
  return lines.flatMap((l) => (l.type === "answer" && !withdrawn.has(l.id) && !applied.has(l.id) ? [l] : []));
};

/** What an answer says, in words. */
export const describe = (a: Answer): string => {
  const x = a.answer;
  switch (x.how) {
    case "accept": return "accepted the recommendation";
    case "choose": return `chose ${x.option}`;
    case "change": return `changed it: ${x.text}`;
    case "done": return "says it is done";
    case "text": return `said: ${x.text}`;
  }
};

/** The log line that marks one answer applied, or why it cannot be. */
export const applyAnswer = (lines: readonly AnswerLine[], log: readonly LogEntry[], id: string, evidence: string, by: string, at: string, commit: string): Result<LogEntry> => {
  const a = unapplied(lines, log).find((x) => x.id === id);
  if (!a) return { ok: false, error: `no unapplied answer ${id}` };
  if (evidence.trim() === "") return { ok: false, error: "applying an answer needs --evidence: the ruling or the unblocked task" };
  return { ok: true, value: { at, by, action: "answers.apply", args: { answer: id, target: a.target, evidence }, commit } };
};
