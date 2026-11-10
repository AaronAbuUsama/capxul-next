import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_BODY, MAX_TEXT, respond, type Deps, type Req } from "./service.ts";
import type { LogEntry } from "./types.ts";

const HOST = "127.0.0.1:4391";

/** A server over memory: the files are strings, the clock and the ids count. */
const world = (log: LogEntry[] = []): { readonly deps: Deps; readonly written: string[]; readonly file: () => string } => {
  const written: string[] = [];
  let n = 0;
  const deps: Deps = {
    now: () => "2026-11-10T10:00:00.000Z", newId: () => `a-${++n}`,
    waiting: () => ({ decisions: new Map([["d.one", ["yes", "no"]]]), tasks: new Set(["t-need"]) }),
    answerLines: () => written.join(""), log: () => log, append: (line) => { written.push(line); },
    file: (path) => (path === "index.html" ? { type: "text/html", body: new TextEncoder().encode("<h1>hi</h1>") } : path === "review/index.html" ? { type: "text/html", body: new Uint8Array() } : null),
    hosts: [HOST, "localhost:4391"],
  };
  return { deps, written, file: () => written.join("") };
};
const req = (over: Partial<Req>): Req => ({ method: "GET", path: "/", host: HOST, origin: "", body: "", tooLarge: false, ...over });
const post = (body: unknown, over: Partial<Req> = {}): Req => req({ method: "POST", path: "/api/answers", body: typeof body === "string" ? body : JSON.stringify(body), ...over });
const decision = (answer: unknown, id = "d.one"): unknown => ({ target: { kind: "decision", id }, answer });

test("a valid answer is appended as one line, and listed until it is applied", () => {
  const { deps, written } = world();
  const r = respond(post(decision({ how: "accept" })), deps);
  assert.equal(r.status, 201);
  assert.equal(written.length, 1);
  assert.deepEqual(JSON.parse(written[0] ?? ""), { type: "answer", id: "a-1", at: "2026-11-10T10:00:00.000Z", target: { kind: "decision", id: "d.one" }, answer: { how: "accept" } });
  assert.ok(written[0]?.endsWith("\n"));
  const listed = JSON.parse(String(respond(req({ path: "/api/answers" }), deps).body)) as { answers: { id: string }[] };
  assert.deepEqual(listed.answers.map((a) => a.id), ["a-1"]);
  const applied = world([{ at: "", by: "", action: "answers.apply", args: { answer: "a-1" }, commit: "" }]);
  applied.written.push(written[0] ?? "");
  assert.deepEqual((JSON.parse(String(respond(req({ path: "/api/answers" }), applied.deps).body)) as { answers: unknown[] }).answers, [], "an applied answer is no longer listed");
});

test("validation: the target must be waiting, the option one of the decision's, the text short, the shape exact", () => {
  const { deps, written } = world();
  const status = (b: unknown, over: Partial<Req> = {}): number => respond(post(b, over), deps).status;
  assert.equal(status(decision({ how: "accept" }, "d.none")), 422, "a decision that does not wait");
  assert.equal(status({ target: { kind: "task", id: "t-none" }, answer: { how: "done" } }), 422, "a task that does not wait");
  assert.equal(status(decision({ how: "choose", option: "maybe" })), 422, "an option the decision does not have");
  assert.equal(status(decision({ how: "choose", option: "no" })), 201);
  assert.equal(status(decision({ how: "change", text: "x".repeat(MAX_TEXT + 1) }), {}), 422, "text over the limit");
  assert.equal(status(decision({ how: "change", text: "  " })), 422, "empty text");
  assert.equal(status(decision({ how: "done" })), 422, "done is for tasks");
  assert.equal(status({ target: { kind: "task", id: "t-need" }, answer: { how: "accept" } }), 422, "accept is for decisions");
  assert.equal(status({ target: { kind: "task", id: "t-need" }, answer: { how: "text", text: "sub.example.org" } }), 201);
  assert.equal(status({ ...(decision({ how: "accept" }) as object), extra: 1 }), 422, "an unknown field");
  assert.equal(status(decision({ how: "accept", extra: 1 })), 422, "an unknown field of the answer");
  assert.equal(status("not json"), 400);
  assert.equal(status("[1]"), 400);
  assert.equal(respond(post("{}", { tooLarge: true }), deps).status, 413);
  assert.equal(written.length, 2, "refused requests wrote nothing");
});

test("one answer per target until it is withdrawn; a withdrawal is a new line, never a rewrite", () => {
  const { deps, written } = world();
  assert.equal(respond(post(decision({ how: "accept" })), deps).status, 201);
  assert.equal(respond(post(decision({ how: "choose", option: "no" })), deps).status, 409);
  assert.equal(respond(post({ withdraw: "a-9" }), deps).status, 404, "no such answer");
  const before = written[0];
  assert.equal(respond(post({ withdraw: "a-1" }), deps).status, 200);
  assert.equal(written.length, 2);
  assert.equal(written[0], before, "the first line is untouched");
  assert.deepEqual({ ...JSON.parse(written[1] ?? "") as object, id: "-" }, { type: "withdraw", id: "-", at: "2026-11-10T10:00:00.000Z", answer: "a-1" });
  assert.deepEqual((JSON.parse(String(respond(req({ path: "/api/answers" }), deps).body)) as { answers: unknown[] }).answers, []);
  assert.equal(respond(post(decision({ how: "choose", option: "no" })), deps).status, 201, "answerable again");
});

test("nothing but appending is possible: other methods, other origins, other hosts, other paths", () => {
  const { deps, written } = world();
  for (const method of ["PUT", "DELETE", "PATCH"]) assert.equal(respond(req({ method, path: "/api/answers" }), deps).status, 405);
  assert.equal(respond(req({ method: "POST", path: "/index.html" }), deps).status, 405);
  assert.equal(respond(post(decision({ how: "accept" }), { origin: "http://evil.example" }), deps).status, 403, "another origin");
  assert.equal(respond(post(decision({ how: "accept" }), { host: "evil.example" }), deps).status, 403, "another host");
  assert.equal(respond(post(decision({ how: "accept" }), { origin: `http://${HOST}` }), deps).status, 201);
  assert.equal(respond(req({ path: "/../plan/plan.json" }), deps).status, 400);
  assert.equal(respond(req({ path: "/%2e%2e/plan.json" }), deps).status, 404, "an encoded path is just a file that is not there");
  assert.equal(written.length, 1);
  assert.ok(MAX_BODY > 1000);
});

test("everything else is the generated site: a folder is its index page, a missing file is a 404", () => {
  const { deps } = world();
  assert.equal(respond(req({ path: "/" }), deps).status, 200);
  assert.equal(respond(req({ path: "/index.html?x=1" }), deps).status, 200);
  assert.equal(respond(req({ path: "/review/" }), deps).status, 200);
  assert.equal(respond(req({ path: "/review" }), deps).status, 200);
  assert.equal(respond(req({ path: "/nope/" }), deps).status, 404);
});
