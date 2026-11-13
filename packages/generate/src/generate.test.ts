import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { factsOf, renderFacts } from "./modules/facts/service.ts";
import { compare, HEADER, withHeader } from "./modules/writer/service.ts";

const r = (kind: string, id: string, extra: Record<string, unknown> = {}) => ({ _kind: kind, id, ...extra });

test("the header hashes everything after its line, so one changed byte is a difference", () => {
  const file = withHeader("export const x = 1;");
  const [head, ...rest] = file.split("\n");
  assert.equal(head, `${HEADER} sha256:${createHash("sha256").update(`${rest.join("\n")}`).digest("hex")}`);
  assert.equal(rest.join("\n"), "export const x = 1;\n");
  const tree = (text: string, extra: string[] = []) => ({ files: ["packages/a/src/generated/x.ts", ...extra], read: () => text });
  const rendered = new Map([["packages/a/src/generated/x.ts", file]]);
  assert.deepEqual(compare(rendered, tree(file)), []);
  assert.deepEqual(compare(rendered, tree(file.replace("= 1", "= 2"))), [{ path: "packages/a/src/generated/x.ts", why: "differs" }]);
  assert.deepEqual(compare(rendered, { files: [], read: () => "" }), [{ path: "packages/a/src/generated/x.ts", why: "missing" }]);
  // A file no target writes is a difference only inside a src/generated/ folder.
  assert.deepEqual(compare(rendered, tree(file, ["packages/b/src/generated/old.ts", "packages/b/src/old.ts", "packages/b/generated/x.ts"])), [
    { path: "packages/b/src/generated/old.ts", why: "not generated" },
  ]);
});

test("facts read concepts from the records, not the ids", () => {
  const payments = r("concept", "payments", { dependsOn: [{ id: "parties" }, { id: "access" }] });
  const sites = r("concept", "sites", { lines: 900 });
  const records = [
    sites, payments,
    r("rpc", "payroll.holders.offer", { concept: payments, spans: ["rpc.payroll.holders.offer"] }),
    r("rpc", "payments.commands.prepare", { concept: payments, spans: [] }),
    r("rpc", "sites.open", { concept: sites, spans: [] }),
    r("procedure", "payments.prepare-command", { concept: payments }),
    r("workflow", "payroll.agreements.lifecycle", { concept: payments, steps: [{ name: "pay" }, { name: "confirm" }], waits: [{ name: "confirm" }] }),
    r("flow", "client.payments.send-now", { sdk: "client.payments(orgId).sendNow", steps: [{ name: "sign-op", local: "sign" }, { name: "ask", local: "prompt" }] }),
    r("operation", "payment.send", { command: "payment  send" }),
    r("integration", "bridge", { calls: { getVerification: {} } }),
  ];
  const facts = factsOf({ records, conceptOf: new Map([["flow:client.payments.send-now", "payments"]]) });
  assert.deepEqual(Object.keys(facts.concepts), ["payments", "sites"]);
  assert.deepEqual(facts.concepts.payments, {
    dependsOn: ["access", "parties"], door: ["prepareCommand"],
    backend: ["commands.ts", "door.ts", "holders.ts", "processes.ts"], sdk: ["flows.ts"], lines: undefined,
  });
  // A two-part id names no area file; lines carries the concept's budget.
  assert.deepEqual(facts.concepts.sites, { dependsOn: [], door: [], backend: [], sdk: [], lines: 900 });
  assert.deepEqual(facts.workflows["payroll.agreements.lifecycle"], { concept: "payments", name: "PayrollAgreementsLifecycle", steps: ["confirm", "pay"], waits: ["confirm"] });
  assert.deepEqual(Object.keys(facts.spans), [
    "call.bridge.getVerification", "cli.payment.send", "db.tx", "rpc.payments.commands.prepare", "rpc.payroll.holders.offer",
    "rpc.sites.open", "sdk.client.payments.send-now", "sdk.step.sign-op", "wait.chain", "wait.person",
    "workflow.payroll.agreements.lifecycle", "workflow.step.confirm", "workflow.step.pay",
  ]);
  assert.equal(facts.spans["sdk.client.payments.send-now"], "Spans.sdk.client.payments.sendNow");
  // Two runs write the same bytes, and the order records arrive in changes nothing.
  assert.equal(renderFacts({ records, conceptOf: new Map([["flow:client.payments.send-now", "payments"]]) }),
    renderFacts({ records: [...records].reverse(), conceptOf: new Map([["flow:client.payments.send-now", "payments"]]) }));
});

test("two span names with one constant fail the generation", () => {
  const records = [r("rpc", "a.b.sign-in", { spans: [] }), r("rpc", "a.b.signIn", { spans: [] })];
  assert.throws(() => factsOf({ records, conceptOf: new Map() }), /rpc\.a\.b\.sign-in and rpc\.a\.b\.signIn would both be Spans\.rpc\.a\.b\.signIn/);
});
