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

/**
 * The targets of applied answers, as the log recorded them. With the answers file, an answer that sent its question back is left
 * out, since the question is still open by design: a `change` to a decision (it is put to the owner again with new options), and a
 * task blocked on a need that was set after the answer was given (a new need, not the one he answered).
 */
export const appliedTargets = (log: readonly LogEntry[], answers: readonly AnswerLine[] = []): readonly Target[] => {
  const given = new Map(answers.flatMap((l) => (l.type === "answer" ? [[l.id, l] as const] : [])));
  return log.flatMap((l) => {
    const t = l.action === "answers.apply" && isFields(l.args) ? l.args["target"] : undefined;
    if (!isFields(t) || (t["kind"] !== "decision" && t["kind"] !== "task") || typeof t["id"] !== "string") return [];
    const id: string = t["id"];
    const a = isFields(l.args) && typeof l.args["answer"] === "string" ? given.get(l.args["answer"]) : undefined;
    if (a && t["kind"] === "decision" && a.answer.how === "change") return [];
    if (a && t["kind"] === "task" && log.some((b) => b.action === "task.block" && isFields(b.args) && b.args["id"] === id && b.at > a.at)) return [];
    return [{ kind: t["kind"], id }];
  });
};

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
