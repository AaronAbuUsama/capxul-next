// doc.create, doc.submit and report.run, served in memory through Core's groups, against a stand-in company site:
// what the site is asked, what Core answers, and what the world's record keeps.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Errors } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { madeFromNothing, PaymentApprovals } from "../src/site-ops/door.ts";
import {
  created,
  fields,
  HASH,
  ORG,
  refusal,
  run,
  site,
  START,
  trace,
  value,
  world,
  type Asked,
} from "./support/site-ops.ts";

test("doc.create runs as the person's site user, answers the site's document and keeps one doc_created", () =>
  run(
    Effect.gen(function* () {
      const asked: Array<Asked> = [];
      const { call, record } = yield* world({
        record: [madeFromNothing("town", "ci", START)],
        sites: [site("other-town.w", "org_other1", asked, {}), site("north-town.w", ORG, asked, { create: created })],
      });
      const supplier = { supplier_name: "Brightside Cleaning Ltd" };
      const made = value(yield* call("doc.create", { org: ORG, doctype: "Supplier", fields: supplier }, "sam"));
      assert.deepEqual(made, {
        doctype: "Supplier",
        name: "Brightside Cleaning Ltd",
        docstatus: 0,
        fields: supplier,
        hash: HASH,
      });
      assert.deepEqual(asked[1], {
        site: "north-town.w",
        method: "create",
        body: { org: ORG, user: "sam@cast.test", doctype: "Supplier", fields: supplier },
      });
      const exported = yield* record();
      assert.equal(exported.head, 2);
      assert.deepEqual(exported.entries[1], {
        seq: 2,
        event: "doc_created",
        at: "2026-11-13T09:00:00.000Z",
        trace: trace(1),
        carried: { org: ORG, doctype: "Supplier", name: "Brightside Cleaning Ltd" },
      });
    }),
  ));

test("the site's refusals are the blueprint's, and a refused call keeps nothing", () =>
  run(
    Effect.gen(function* () {
      const asked: Array<Asked> = [];
      const answers = {
        create: (body: Record<string, unknown>) =>
          body["user"] === "pat@cast.test" || body["user"] === null
            ? { refused: "no-site-user" }
            : { refused: "site-refused", target: body["doctype"], reason: "permission", message: "no create" },
      };
      const { call, record } = yield* world({
        record: [madeFromNothing("town", "ci", START)],
        sites: [site("north-town.w", ORG, asked, answers)],
      });
      const doc = { org: ORG, doctype: "Employee", fields: {} };
      assert.deepEqual(fields(yield* call("doc.create", doc, "pat")), { _tag: "NoSiteUser", org: ORG, person: "pat" });
      assert.deepEqual(fields(yield* call("doc.create", doc)), { _tag: "NoSiteUser", org: ORG, person: "ci" });
      const refused = refusal(yield* call("doc.create", doc, "sam"));
      assert.ok(Schema.is(Errors.SiteRefused)(refused));
      assert.deepEqual([refused.target, refused.reason], ["Employee", "permission"]);
      const nobody = yield* call("doc.create", { ...doc, org: "org_nobody1" }, "sam");
      assert.ok(nobody.pipe(refusal, Schema.is(Errors.OrgNotFound)));
      assert.equal((yield* record()).head, 1);
    }),
  ));

test("no ready site of the company is SiteUnavailable while one is made, and no bench is OrgNotFound", () =>
  run(
    Effect.gen(function* () {
      const creating = yield* world({ sites: [site("north-town.w", ORG, [], {}, "creating")] });
      const unavailable = refusal(
        yield* creating.call("report.run", { org: ORG, report: "General Ledger", filters: {} }, "sam"),
      );
      assert.ok(Schema.is(Errors.SiteUnavailable)(unavailable));
      assert.equal(unavailable.state, "creating");
      const none = yield* world({});
      const noBench = yield* none.call("report.run", { org: ORG, report: "x", filters: {} });
      assert.ok(noBench.pipe(refusal, Schema.is(Errors.OrgNotFound)));
    }),
  ));

test("report.run answers the site's columns and rows, as the person", () =>
  run(
    Effect.gen(function* () {
      const asked: Array<Asked> = [];
      const report = {
        report: "General Ledger",
        columns: [{ field: "account", label: "Account", type: "Link" }],
        rows: [{ account: "Capxul Safe (USDC) - N", debit: 0, credit: 125.5, voucher_no: "ACC-PAY-1" }],
      };
      const { call } = yield* world({ sites: [site("north-town.w", ORG, asked, { report: () => report })] });
      const filters = { account: "Capxul Safe (USDC) - N" };
      assert.deepEqual(
        value(yield* call("report.run", { org: ORG, report: "General Ledger", filters }, "sam")),
        report,
      );
      assert.deepEqual(asked[0]?.body, { org: ORG, user: "sam@cast.test", report: "General Ledger", filters });
    }),
  ));

const approval = {
  id: "apr_pay00001",
  signer: "sam",
  signerAddress: `0x${Str.repeat(20)("03")}`,
  digest: `0x${Str.repeat(32)("12")}`,
  expiresAt: "2026-11-14T09:00:00.000Z",
};

test("doc.submit posts an ordinary document, refuses one that is not a draft, and holds a Safe payment with doc.create's hash", () =>
  run(
    Effect.gen(function* () {
      const asked: Array<Asked> = [];
      const opened = yield* Ref.make<ReadonlyArray<unknown>>([]);
      const approvals = Layer.succeed(
        PaymentApprovals,
        PaymentApprovals.of({
          open: (payment) =>
            Ref.update(opened, (all) => [...all, payment]).pipe(
              Effect.as({ request: "req_pay00001", paymentId: `0x${Str.repeat(32)("9a")}`, approval }),
            ),
        }),
      );
      const answers = {
        create: (body: Record<string, unknown>) => ({ ...created(body), name: "ACC-PAY-1" }),
        submit: (body: Record<string, unknown>) =>
          body["name"] === "PINV-1"
            ? { posted: { doctype: "Purchase Invoice", name: "PINV-1", docstatus: 1 } }
            : body["name"] === "PINV-0"
              ? { refused: "not-a-draft", docstatus: 1 }
              : {
                  payment: {
                    payee: "Brightside Cleaning Ltd",
                    payee_address: `0x${Str.repeat(20)("b2")}`,
                    amount: "125.50",
                    asset: "USDC",
                    safe: `0x${Str.repeat(20)("55")}`,
                    document_hash: `0x${Str.repeat(32)("ee")}`,
                  },
                },
        hold: (body: Record<string, unknown>) => ({
          held: { doctype: "Payment Entry", name: body["name"], docstatus: 0 },
        }),
      };
      const { call, record } = yield* world({
        approvals,
        record: [madeFromNothing("town", "ci", START)],
        sites: [site("north-town.w", ORG, asked, answers)],
      });
      const posted = value(yield* call("doc.submit", { org: ORG, doctype: "Purchase Invoice", name: "PINV-1" }, "sam"));
      assert.deepEqual(
        [posted._tag, posted.doctype, posted.name, posted.docstatus],
        ["Posted", "Purchase Invoice", "PINV-1", 1],
      );
      const draft = fields(yield* call("doc.submit", { org: ORG, doctype: "Purchase Invoice", name: "PINV-0" }, "sam"));
      assert.deepEqual(draft, { _tag: "NotADraft", doctype: "Purchase Invoice", name: "PINV-0", docstatus: 1 });

      value(yield* call("doc.create", { org: ORG, doctype: "Payment Entry", fields: {} }, "sam"));
      const held = value(yield* call("doc.submit", { org: ORG, doctype: "Payment Entry", name: "ACC-PAY-1" }, "sam"));
      assert.equal(held._tag, "Held");
      assert.deepEqual(held.payment, {
        request: "req_pay00001",
        amount: { asset: "USDC", amount: "125.50" },
        payee: "Brightside Cleaning Ltd",
        payeeAddress: `0x${Str.repeat(20)("b2")}`,
        documentHash: HASH,
        paymentId: `0x${Str.repeat(32)("9a")}`,
      });
      assert.deepEqual(held.approval, approval);
      const [payment] = yield* Ref.get(opened);
      assert.deepEqual(payment, {
        org: ORG,
        person: "sam",
        document: { doctype: "Payment Entry", name: "ACC-PAY-1" },
        payee: "Brightside Cleaning Ltd",
        payeeAddress: `0x${Str.repeat(20)("b2")}`,
        amount: { asset: "USDC", amount: "125.50" },
        safe: `0x${Str.repeat(20)("55")}`,
        documentHash: HASH,
      });
      assert.deepEqual(asked.at(-1)?.body, {
        org: ORG,
        user: "sam@cast.test",
        name: "ACC-PAY-1",
        document_hash: HASH,
        request: "req_pay00001",
        approval: "apr_pay00001",
        payment_id: `0x${Str.repeat(32)("9a")}`,
      });
      const entries = (yield* record()).entries;
      assert.deepEqual(
        Arr.map(entries, (entry: { readonly event: string }) => entry.event),
        ["world_created", "doc_submitted", "doc_created", "payment_held"],
      );
      assert.deepEqual(entries[3]?.carried, {
        org: ORG,
        doctype: "Payment Entry",
        name: "ACC-PAY-1",
        request: "req_pay00001",
        approval: "apr_pay00001",
        amount: { asset: "USDC", amount: "125.50" },
      });
    }),
  ));

test("a Safe payment with no approvals built dies, naming what is missing, and holds nothing", () =>
  run(
    Effect.gen(function* () {
      const asked: Array<Asked> = [];
      const payment = {
        payee: "B",
        payee_address: `0x${Str.repeat(20)("b2")}`,
        amount: "1",
        asset: "USDC",
        safe: `0x${Str.repeat(20)("55")}`,
        document_hash: HASH,
      };
      const { call } = yield* world({ sites: [site("north-town.w", ORG, asked, { submit: () => ({ payment }) })] });
      const exit = yield* call("doc.submit", { org: ORG, doctype: "Payment Entry", name: "ACC-PAY-2" }, "sam");
      assert.ok(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
      assert.match(exit.cause.pipe(Cause.pretty), /approval\.sign's PaymentApprovals/);
      assert.deepEqual(
        Arr.map(asked, (each) => each.method),
        ["submit"],
      );
    }),
  ));
