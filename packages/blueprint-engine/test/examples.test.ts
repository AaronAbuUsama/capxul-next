import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBlueprint, defineOperation } from "../src/index.ts";
import * as f from "./fixtures/invitations.ts";

const withExamples = (examples: readonly unknown[], stage: "as-is" | "target" = "as-is") => {
  const invite = defineOperation({ ...f.invite, examples: examples as never });
  return buildBlueprint({ name: "t", stage, records: [...f.records.filter((r) => r !== f.invite), invite] });
};
const ok = { title: "Invite a colleague", input: "capxul org member invite ada@example.com --role admin --json", output: { invitation: "inv_1" }, exit: 0 };
const refusal = { title: "A member may not invite", input: "capxul org member invite ada@example.com --json", output: { error: { code: "ROLE_PERMISSION_DENIED", message: "Ask an Owner." } }, exit: 3 };
const found = (b: ReturnType<typeof withExamples>) => b.problems.filter((p) => p.rule === "example-mismatch").map((p) => p.detail);

test("an example whose output conforms to returns, and a declared refusal with its exit, build with no problem", () => {
  assert.deepEqual(withExamples([ok, refusal]).problems, []);
});

test("a success whose output breaks returns is a problem that names the example and the field", () => {
  const [one, ...rest] = found(withExamples([ok, { ...ok, title: "Wrong", output: { invitation: 7 } }]));
  assert.equal(rest.length, 0);
  assert.match(one ?? "", /example 2 \(Wrong\): its output does not conform to returns.*invitation/);
});

test("a refusal must be one the operation declares, with the error's exit code", () => {
  assert.match(found(withExamples([{ ...refusal, exit: 1 }]))[0] ?? "", /whose exit code is 3, not 1/);
  assert.match(found(withExamples([{ ...refusal, output: { error: { code: "WRONG_STATE", message: "x" } }, exit: 5 }]))[0] ?? "", /WRONG_STATE, which the operation does not declare/);
  assert.match(found(withExamples([{ ...refusal, output: { invitation: "x" } }]))[0] ?? "", /prints no \{ error: \{ code \} \}/);
});

test("an example's input names the operation's command", () => {
  assert.match(found(withExamples([{ ...ok, input: "capxul org seats buy" }]))[0] ?? "", /does not name the command "org member invite"/);
});

test("a malformed example is refused when the record is defined", () => {
  assert.throws(() => defineOperation({ ...f.invite, examples: [{ title: "x", input: "capxul org member invite", exit: 0 }] as never }));
  assert.throws(() => defineOperation({ ...f.invite, examples: [{ ...ok, exit: -1 }] }));
});

test("an operation with no example is a no-example gap in a blueprint, and gains none by having one", () => {
  const none = buildBlueprint({ name: "t", stage: "target", records: f.records });
  assert.deepEqual(none.gaps.filter((g) => g.rule === "no-example").map((g) => g.record), ["operation:org.member.invite", "operation:invite.accept"]);
  const one = withExamples([ok], "target");
  assert.deepEqual(one.gaps.filter((g) => g.rule === "no-example").map((g) => g.record), ["operation:invite.accept"]);
  assert.equal(buildBlueprint({ name: "t", stage: "as-is", records: f.records }).gaps.some((g) => g.rule === "no-example"), false);
});
