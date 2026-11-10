/** The answers module's door: `respond` turns one request into one response. See README.md. */
import { parseAnswerLines, unapplied } from "@capxul/plan";
import { isFields, lineOf, newAnswer, newWithdrawal } from "./internal/validate.ts";
import { MAX_BODY, type Deps, type Req, type Res } from "./types.ts";
import type { Answer } from "./types.ts";

export { MAX_BODY, MAX_TEXT } from "./types.ts";
export type { Deps, Req, Res, Waiting } from "./types.ts";

const json = (status: number, value: unknown): Res => ({ status, type: "application/json; charset=utf-8", body: `${JSON.stringify(value)}\n` });
const fail = (status: number, error: string): Res => json(status, { error });

/** The answers still to apply: not withdrawn, not applied. */
const active = (deps: Deps): readonly Answer[] => unapplied(parseAnswerLines(deps.answerLines()), deps.log());

const post = (req: Req, deps: Deps): Res => {
  if (req.tooLarge) return fail(413, `the body is larger than ${MAX_BODY} bytes`);
  let body: unknown;
  try { body = JSON.parse(req.body); } catch { return fail(400, "the body is not JSON"); }
  if (!isFields(body)) return fail(400, "the body is not an object");
  if ("withdraw" in body) {
    const w = newWithdrawal(body, active(deps), deps.newId(), deps.now());
    if (!w.ok) return fail(404, w.error);
    deps.append(lineOf(w.value));
    return json(200, { withdrawn: w.value.answer });
  }
  const a = newAnswer(body, deps.waiting(), deps.newId(), deps.now());
  if (!a.ok) return fail(422, a.error);
  if (active(deps).some((x) => x.target.kind === a.value.target.kind && x.target.id === a.value.target.id)) {
    return fail(409, "this is already answered: undo that answer first");
  }
  deps.append(lineOf(a.value));
  return json(201, { answer: a.value });
};

/** Only this server's own origin may write: a page from another origin cannot post to it. */
const sameOrigin = (req: Req, deps: Deps): boolean =>
  deps.hosts.includes(req.host) && (req.origin === "" || deps.hosts.some((h) => req.origin === `http://${h}` || req.origin === `https://${h}`));

/**
 * One request, one response. `/api/answers` takes GET (the answers not yet applied) and POST (a new answer or a
 * withdrawal); every other GET is a file of the generated site. Nothing else is possible, and the only write is one line
 * appended to plan/answers.jsonl.
 */
export const respond = (req: Req, deps: Deps): Res => {
  if (!deps.hosts.includes(req.host)) return fail(403, "wrong host");
  const clean = req.path.split("?")[0] ?? "/";
  if (clean === "/api/answers") {
    if (req.method === "GET") return json(200, { answers: active(deps) });
    if (req.method !== "POST") return fail(405, "GET or POST");
    return sameOrigin(req, deps) ? post(req, deps) : fail(403, "wrong origin");
  }
  if (req.method !== "GET" && req.method !== "HEAD") return fail(405, "GET");
  if (clean.includes("..") || clean.includes("\0") || clean.includes("\\")) return fail(400, "bad path");
  const wanted = clean.endsWith("/") ? `${clean}index.html` : clean;
  const found = deps.file(wanted.slice(1)) ?? deps.file(`${wanted.slice(1)}/index.html`);
  return found ? { status: 200, type: found.type, body: found.body } : fail(404, "not found");
};
