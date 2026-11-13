import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { renderConfigs, renderErrors, renderSpans } from "./modules/b1/service.ts";
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

test("a span that is also another's prefix is its node's _, in Spans and in the facts alike", () => {
  const records = [r("operation", "bank.accounts", { command: "bank accounts" }), r("operation", "bank.accounts.add", { command: "bank accounts add" })];
  assert.equal(factsOf({ records, conceptOf: new Map() }).spans["cli.bank.accounts"], "Spans.cli.bank.accounts._");
  assert.equal(factsOf({ records, conceptOf: new Map() }).spans["cli.bank.accounts.add"], "Spans.cli.bank.accounts.add");
  const spans = renderSpans(records);
  assert.match(spans, /accounts: \{\n {8}_: "cli\.bank\.accounts",\n {8}add: "cli\.bank\.accounts\.add",/);
});

test("errors are one class per record, named from the code; a config entry and a secret are both required", () => {
  const errors = renderErrors([r("error", "NOT_AUTHENTICATED", { class: "auth", actor: "caller", message: "m", retryable: false, exit: 3 })]);
  assert.match(errors, /export class NotAuthenticated extends Schema\.TaggedError<NotAuthenticated>\(\)\("NotAuthenticated", \{ cause: Schema\.optional\(Schema\.Defect\(\)\) \}\)/);
  assert.match(errors, /static readonly code = "NOT_AUTHENTICATED";\n.*\n.*\n.*\n.*\n {2}static readonly exit = 3;/);
  assert.throws(() => renderErrors([r("error", "A_B"), r("error", "A__B")]), /A_B and A__B would both be AB/);
  const configs = renderConfigs([r("environment", "shared-world", { config: ["SITE_URL"], secrets: ["DATABASE_URL"] })]);
  assert.deepEqual([...configs.keys()], ["config/shared-world.ts"]);
  assert.match(configs.get("config/shared-world.ts")!, /SharedWorldConfig = Config\.all\(\{\n {2}DATABASE_URL: Config\.Redacted\("DATABASE_URL"\),\n {2}SITE_URL: Config\.NonEmptyString\("SITE_URL"\),\n\}\);/);
  assert.throws(() => renderConfigs([r("environment", "x", { config: ["K"], secrets: ["K"] })]), /lists K as both config and secret/);
});
