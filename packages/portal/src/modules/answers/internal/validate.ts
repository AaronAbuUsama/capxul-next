/** One request body as a new answer or a withdrawal, or why not. Hard: unknown fields and kinds are refused. */
import type { Answer, AnswerLine, How, Waiting, Withdrawal } from "../types.ts";
import { MAX_TEXT } from "../types.ts";

type Fields = Readonly<Record<string, unknown>>;
const isFields = (u: unknown): u is Fields => typeof u === "object" && u !== null && !Array.isArray(u);
const refuse = (error: string): Result<never> => ({ ok: false, error });
export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

const onlyKeys = (u: Fields, keys: readonly string[]): boolean => Object.keys(u).every((k) => keys.includes(k));

/** The words of an answer: a string of 1 to MAX_TEXT characters once trimmed. */
const textOf = (u: unknown): Result<string> => {
  if (typeof u !== "string") return refuse("text must be a string");
  const t = u.trim();
  return t === "" ? refuse("text is empty") : t.length > MAX_TEXT ? refuse(`text is longer than ${MAX_TEXT} characters`) : { ok: true, value: t };
};

const howFor = (kind: "decision" | "task", u: unknown, options: readonly string[]): Result<How> => {
  if (!isFields(u) || typeof u["how"] !== "string") return refuse("answer must say how");
  const how = u["how"];
  if (kind === "decision") {
    if (how === "accept") return onlyKeys(u, ["how"]) ? { ok: true, value: { how } } : refuse("accept takes nothing else");
    if (how === "choose") {
      if (!onlyKeys(u, ["how", "option"]) || typeof u["option"] !== "string") return refuse("choose takes an option");
      return options.includes(u["option"]) ? { ok: true, value: { how, option: u["option"] } } : refuse(`${u["option"]} is not an option of this decision`);
    }
    if (how === "change") {
      const t = onlyKeys(u, ["how", "text"]) ? textOf(u["text"]) : refuse("change takes text");
      return t.ok ? { ok: true, value: { how, text: t.value } } : t;
    }
    return refuse("a decision is answered with accept, choose or change");
  }
  if (how === "done") return onlyKeys(u, ["how"]) ? { ok: true, value: { how } } : refuse("done takes nothing else");
  if (how === "text") {
    const t = onlyKeys(u, ["how", "text"]) ? textOf(u["text"]) : refuse("text takes text");
    return t.ok ? { ok: true, value: { how, text: t.value } } : t;
  }
  return refuse("a task is answered with done or text");
};

/** A body `{ target, answer }`: the target must be waiting, the answer one that fits it. */
export const newAnswer = (body: Fields, waiting: Waiting, id: string, at: string): Result<Answer> => {
  if (!onlyKeys(body, ["target", "answer"]) || !isFields(body["target"])) return refuse("body is { target, answer }");
  const t = body["target"];
  if (!onlyKeys(t, ["kind", "id"]) || (t["kind"] !== "decision" && t["kind"] !== "task") || typeof t["id"] !== "string") return refuse("target is { kind: decision | task, id }");
  const options = t["kind"] === "decision" ? waiting.decisions.get(t["id"]) : undefined;
  if (t["kind"] === "decision" && options === undefined) return refuse(`${t["id"]} is not a decision that waits for you`);
  if (t["kind"] === "task" && !waiting.tasks.has(t["id"])) return refuse(`${t["id"]} is not a task that waits for you`);
  const how = howFor(t["kind"], body["answer"], options ?? []);
  return how.ok ? { ok: true, value: { type: "answer", id, at, target: { kind: t["kind"], id: t["id"] }, answer: how.value } } : how;
};

/** A body `{ withdraw: <answer id> }`: only an answer that is still to be applied can be withdrawn. */
export const newWithdrawal = (body: Fields, active: readonly Answer[], id: string, at: string): Result<Withdrawal> => {
  if (!onlyKeys(body, ["withdraw"]) || typeof body["withdraw"] !== "string") return refuse("body is { withdraw: <answer id> }");
  const wanted = body["withdraw"];
  return active.some((a) => a.id === wanted) ? { ok: true, value: { type: "withdraw", id, at, answer: wanted } } : refuse(`no unapplied answer ${wanted}`);
};

export const lineOf = (l: AnswerLine): string => `${JSON.stringify(l)}\n`;
export { isFields };
